import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AwsClient } from 'aws4fetch'

/*
 * Where every photo file lives: his photos, try-ons, flat lays, and the photos
 * of his pieces and of finds he added by hand. A key is the path a row keeps
 * (`3e3f….jpg`, `wardrobe/….thumb.jpg`, `try-ons/12-….jpg`), the same in both
 * stores, so moving between them is copying files and never touches a row.
 *
 * In production it is a private Cloudflare R2 bucket (Malin's call,
 * 2026-11-07, so photos do not fill the Coolify server). The bucket is never
 * public: the app reads it with its own key and /photos/* stays the one door,
 * behind the sign-in. Without the R2 settings it is a folder (PHOTOS_DIR),
 * which is what dev and the tests use.
 */

export type FileStore = {
  /** Where files go, for the health check and logs. */
  readonly where: string
  readonly kind: 'r2' | 'folder'
  put(key: string, data: Buffer, contentType?: string): Promise<void>
  /** The file, or null when there is none. Any other failure throws. */
  get(key: string): Promise<Buffer | null>
  /** Gone, or was never there. */
  remove(key: string): Promise<void>
  /** The MD5 hex of a stored file, or null when there is none. */
  md5(key: string): Promise<string | null>
}

export class StorageConfigError extends Error {}

const R2_SETTINGS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const

let cached: { signature: string; store: FileStore } | null = null

/**
 * The store the environment names. All four R2 settings make it R2; none
 * leaves it a folder; some but not all is a mistake that would quietly write
 * photos to the server's disk, so it throws.
 */
export function files(): FileStore {
  const values = R2_SETTINGS.map((name) => process.env[name]?.trim() ?? '')
  const signature = [...values, process.env.PHOTOS_DIR ?? ''].join('\n')
  if (cached?.signature === signature) return cached.store

  const missing = R2_SETTINGS.filter((_, index) => !values[index])
  let store: FileStore
  if (missing.length === 0) {
    const [accountId, accessKeyId, secretAccessKey, bucket] = values as [string, string, string, string]
    store = r2Store({ accountId, accessKeyId, secretAccessKey, bucket })
  } else if (missing.length === R2_SETTINGS.length) {
    store = folderStore(photosDir())
  } else {
    throw new StorageConfigError(`R2 is half set up: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`)
  }
  cached = { signature, store }
  return store
}

/*
 * The folder sits outside the app (a volume in Docker, before R2), so the
 * bundler must not try to trace these paths: without the turbopackIgnore hints
 * it treats every runtime path as a reference into the project and copies the
 * whole repository into the server output.
 */
export function photosDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.PHOTOS_DIR ?? './data/photos')
}

export function folderStore(dir: string): FileStore {
  const at = (key: string) => path.join(/*turbopackIgnore: true*/ dir, safeKey(key))
  async function get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(/*turbopackIgnore: true*/ at(key))
    } catch (error) {
      if (missingFile(error)) return null
      throw error
    }
  }
  return {
    where: dir,
    kind: 'folder',
    async put(key, data) {
      const file = at(key)
      await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true })
      await writeFile(/*turbopackIgnore: true*/ file, data)
    },
    get,
    async remove(key) {
      await unlink(/*turbopackIgnore: true*/ at(key)).catch((error: unknown) => {
        if (!missingFile(error)) throw error
      })
    },
    async md5(key) {
      const data = await get(key)
      return data ? createHash('md5').update(data).digest('hex') : null
    },
  }
}

export type R2Settings = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }

/**
 * R2 through its S3 API, signed by aws4fetch. Path-style addresses, region
 * `auto`. Every upload carries its MD5, so R2 refuses one that arrives
 * damaged, and the ETag it keeps is that MD5, which is how `md5` answers
 * without downloading. `fetchImpl` is for the tests.
 */
export function r2Store(settings: R2Settings, fetchImpl: typeof fetch = fetch): FileStore {
  const client = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: 's3',
    region: 'auto',
  })
  const origin = `https://${settings.accountId}.r2.cloudflarestorage.com`
  const url = (key: string) => `${origin}/${settings.bucket}/${safeKey(key).split('/').map(encodeURIComponent).join('/')}`

  async function send(method: string, key: string, init: { body?: Uint8Array<ArrayBuffer>; headers?: Record<string, string> } = {}): Promise<Response> {
    const signed = await client.sign(url(key), { method, ...init })
    // Sent as the signed headers and the bytes themselves, never the signed Request: a Request
    // holds its body as a stream, which fetch sends chunked with no Content-Length, and R2
    // refuses that with 411 MissingContentLength. Bytes go with their length, on every try.
    const request = { method, headers: signed.headers, body: init.body }
    // A network failure or a 5xx is tried again, three tries in all; anything else is an answer.
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetchImpl(signed.url, request)
        if (response.status < 500 || attempt === 3) return response
        await response.body?.cancel()
      } catch (error) {
        if (attempt === 3) throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }

  async function fail(response: Response, what: string): Promise<never> {
    const body = (await response.text().catch(() => '')).slice(0, 300)
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1]
    throw new Error(`R2 ${what}: ${response.status}${code ? ` ${code}` : ''}`)
  }

  return {
    where: `R2 bucket ${settings.bucket}`,
    kind: 'r2',
    async put(key, data, contentType = contentTypeOf(key)) {
      // A copy, so the body is a plain ArrayBuffer view whatever pool the Buffer came from.
      const body = new Uint8Array(data)
      const response = await send('PUT', key, {
        body,
        headers: {
          'content-type': contentType,
          'content-md5': createHash('md5').update(data).digest('base64'),
          // aws4fetch would send UNSIGNED-PAYLOAD for S3; signing the body's hash is cheap and stricter.
          'x-amz-content-sha256': createHash('sha256').update(data).digest('hex'),
        },
      })
      if (!response.ok) await fail(response, `put ${key}`)
      await response.body?.cancel()
    },
    async get(key) {
      const response = await send('GET', key)
      if (response.status === 404) {
        await response.body?.cancel()
        return null
      }
      if (!response.ok) await fail(response, `get ${key}`)
      return Buffer.from(await response.arrayBuffer())
    },
    async remove(key) {
      // R2 answers 204 whether or not the file was there.
      const response = await send('DELETE', key)
      if (!response.ok && response.status !== 404) await fail(response, `delete ${key}`)
      await response.body?.cancel()
    },
    async md5(key) {
      const response = await send('HEAD', key)
      if (response.status === 404) return null
      if (!response.ok) await fail(response, `head ${key}`)
      return response.headers.get('etag')?.replaceAll('"', '').toLowerCase() ?? null
    },
  }
}

/** Keys are relative paths the app made; one that climbs out is a bug. */
function safeKey(key: string): string {
  if (!key || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Not a file key: ${JSON.stringify(key)}`)
  }
  return key
}

export function contentTypeOf(key: string): string {
  if (/\.jpe?g$/i.test(key)) return 'image/jpeg'
  if (/\.png$/i.test(key)) return 'image/png'
  if (/\.webp$/i.test(key)) return 'image/webp'
  return 'application/octet-stream'
}

function missingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Whether photos can be written, by writing, reading back and deleting a tiny
 * file. In production a folder is a failure too: it means the R2 settings are
 * missing and photos are filling the server's disk.
 */
export async function checkFiles(): Promise<{ ok: boolean; detail: string }> {
  let store: FileStore
  try {
    store = files()
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  const key = `health/${process.pid}-${Date.now()}.txt`
  const probe = Buffer.from('ok')
  try {
    await store.put(key, probe, 'text/plain')
    const back = await store.get(key)
    await store.remove(key)
    if (!back?.equals(probe)) return { ok: false, detail: `${store.where}: wrote a file and read back something else` }
  } catch (error) {
    return { ok: false, detail: `${store.where}: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (store.kind === 'folder' && process.env.NODE_ENV === 'production') {
    return { ok: false, detail: `${store.where} is writable, but R2 is not set up, so photos are going to the server's disk` }
  }
  return { ok: true, detail: `${store.where} is writable` }
}

// ---------------------------------------------------------------------------
// The move from the folder to R2 (scripts/move-photos.ts)
// ---------------------------------------------------------------------------

/** Every file under a folder, as a key. Hidden files and the health probes are skipped. */
export async function folderKeys(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(/*turbopackIgnore: true*/ dir, { recursive: true })
  } catch (error) {
    if (missingFile(error)) return []
    throw error
  }
  const keys: string[] = []
  for (const entry of entries) {
    const key = entry.split(path.sep).join('/')
    if (key.startsWith('health/') || key.split('/').some((part) => part.startsWith('.'))) continue
    if ((await stat(/*turbopackIgnore: true*/ path.join(dir, entry))).isFile()) keys.push(key)
  }
  return keys.sort()
}

export type CopyResult = { copied: number; already: number; pruned: number; failed: { key: string; message: string }[] }

/**
 * Copies each key from one store to the other and checks the copy's MD5. A
 * key the target already holds with the same MD5 is not sent again. With
 * `prune`, the source's file goes once the target's copy is known to match.
 */
export async function copyFiles(keys: string[], from: FileStore, to: FileStore, options: { prune: boolean }): Promise<CopyResult> {
  const result: CopyResult = { copied: 0, already: 0, pruned: 0, failed: [] }
  await inBatches(keys, 4, async (key) => {
    try {
      const data = await from.get(key)
      if (!data) throw new Error('the file went missing')
      const want = createHash('md5').update(data).digest('hex')
      if ((await to.md5(key)) === want) {
        result.already++
      } else {
        await to.put(key, data)
        if ((await to.md5(key)) !== want) throw new Error('the copy holds different bytes')
        result.copied++
      }
      if (options.prune) {
        await from.remove(key)
        result.pruned++
      }
    } catch (error) {
      result.failed.push({ key, message: error instanceof Error ? error.message : String(error) })
    }
  })
  result.failed.sort((a, b) => a.key.localeCompare(b.key))
  return result
}

/** The keys a store does not hold. */
export async function missingKeys(keys: string[], store: FileStore): Promise<string[]> {
  const missing: string[] = []
  await inBatches(keys, 8, async (key) => {
    if ((await store.md5(key)) === null) missing.push(key)
  })
  return missing.sort()
}

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!)
    }),
  )
}
