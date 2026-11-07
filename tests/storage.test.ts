import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import {
  checkFiles,
  contentTypeOf,
  copyFiles,
  files,
  folderKeys,
  folderStore,
  missingKeys,
  r2Store,
  StorageConfigError,
  type FileStore,
  type R2Settings,
} from '../src/lib/storage.ts'

/*
 * The photo store: the folder against a throwaway directory, R2 against a
 * fake fetch that records what would have been sent, and once through Node's
 * real fetch to a local server, for what reaches the wire. Nothing leaves the
 * machine.
 */

const settings: R2Settings = { accountId: 'acct123', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', bucket: 'wardrobe-photos' }
const R2_NAMES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const

type Sent = { method: string; url: string; headers: Headers; body: Buffer }

function fakeR2(answer: (sent: Sent, index: number) => Response) {
  const sent: Sent[] = []
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    // Bytes, not a stream or a Request: only bytes go out with a Content-Length, which R2 requires.
    assert.equal(typeof input, 'string')
    assert.ok(init.body === undefined || init.body instanceof Uint8Array, 'the body is sent as bytes')
    const entry = { method: init.method ?? 'GET', url: input, headers: new Headers(init.headers), body: Buffer.from((init.body as Uint8Array | undefined) ?? []) }
    sent.push(entry)
    return answer(entry, sent.length - 1)
  }) as typeof fetch
  return { sent, store: r2Store(settings, fetchImpl) }
}

const md5 = (data: Buffer) => createHash('md5').update(data).digest()

describe('folder store', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-storage-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('puts, gets, hashes and removes a file under a nested key', async () => {
    const store = folderStore(dir)
    const data = Buffer.from('a jpeg, honestly')
    await store.put('try-ons/1-abc.jpg', data)
    assert.deepEqual(await readFile(path.join(dir, 'try-ons/1-abc.jpg')), data)
    assert.deepEqual(await store.get('try-ons/1-abc.jpg'), data)
    assert.equal(await store.md5('try-ons/1-abc.jpg'), md5(data).toString('hex'))
    await store.remove('try-ons/1-abc.jpg')
    assert.equal(await store.get('try-ons/1-abc.jpg'), null)
    assert.equal(await store.md5('try-ons/1-abc.jpg'), null)
    await store.remove('try-ons/1-abc.jpg')
  })

  test('refuses a key that climbs out or is absolute', async () => {
    const store = folderStore(dir)
    await assert.rejects(store.get('../secret.jpg'))
    await assert.rejects(store.put('/etc/passwd', Buffer.from('x')))
    await assert.rejects(store.remove('wardrobe//a.jpg'))
  })
})

describe('R2 store', () => {
  test('a put is signed for R2, path-style, with the MD5 R2 checks', async () => {
    const { sent, store } = fakeR2(() => new Response(null, { status: 200 }))
    const data = Buffer.from('master jpeg bytes')
    await store.put('wardrobe/abc.thumb.jpg', data)

    assert.equal(sent.length, 1)
    const [put] = sent as [Sent]
    assert.equal(put.method, 'PUT')
    assert.equal(put.url, 'https://acct123.r2.cloudflarestorage.com/wardrobe-photos/wardrobe/abc.thumb.jpg')
    assert.deepEqual(put.body, data)
    assert.equal(put.headers.get('content-type'), 'image/jpeg')
    assert.equal(put.headers.get('content-md5'), md5(data).toString('base64'))
    assert.equal(put.headers.get('x-amz-content-sha256'), createHash('sha256').update(data).digest('hex'))
    const auth = put.headers.get('authorization') ?? ''
    assert.match(auth, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, /)
    assert.match(auth, /SignedHeaders=[^,]*content-md5/, 'the MD5 is part of the signature')
  })

  test('a missing file is null, a found one is its bytes', async () => {
    const data = Buffer.from('thumb')
    const { sent, store } = fakeR2((request) =>
      request.url.endsWith('/there.jpg') ? new Response(data, { status: 200 }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }),
    )
    assert.equal(await store.get('gone.jpg'), null)
    assert.deepEqual(await store.get('there.jpg'), data)
    assert.deepEqual(
      sent.map((request) => request.method),
      ['GET', 'GET'],
    )
  })

  test('a refusal throws with R2’s code, and is not retried', async () => {
    const { sent, store } = fakeR2(() => new Response('<Error><Code>AccessDenied</Code><Message>no</Message></Error>', { status: 403 }))
    await assert.rejects(store.get('a.jpg'), /R2 get a\.jpg: 403 AccessDenied/)
    assert.equal(sent.length, 1)
  })

  test('a 5xx is tried again, up to three times', async () => {
    const { sent, store } = fakeR2((_, index) => new Response(null, { status: index < 2 ? 503 : 200 }))
    await store.put('a.jpg', Buffer.from('x'))
    assert.equal(sent.length, 3)
    assert.ok(sent.every((request) => request.body.toString() === 'x'), 'every try sends the whole body')

    const down = fakeR2(() => new Response(null, { status: 500 }))
    await assert.rejects(down.store.put('a.jpg', Buffer.from('x')), /R2 put a\.jpg: 500/)
    assert.equal(down.sent.length, 3)
  })

  test('a put reaches the wire with a Content-Length, not chunked (R2 answers 411 otherwise)', async () => {
    const seen: { length?: string; chunked?: string; body: Buffer }[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        seen.push({ length: request.headers['content-length'], chunked: request.headers['transfer-encoding'], body: Buffer.concat(chunks) })
        response.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      // Node's own fetch, pointed at the local server in place of R2.
      const local = ((input: string, init?: RequestInit) =>
        fetch(input.replace('https://acct123.r2.cloudflarestorage.com', `http://127.0.0.1:${port}`), init)) as typeof fetch
      const data = Buffer.from('a master jpeg, 1568px')
      await r2Store(settings, local).put('wardrobe/abc.jpg', data)
      assert.equal(seen.length, 1)
      assert.equal(seen[0]?.length, String(data.length))
      assert.equal(seen[0]?.chunked, undefined)
      assert.deepEqual(seen[0]?.body, data)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  test('the MD5 comes from the ETag, without downloading', async () => {
    const data = Buffer.from('stored')
    const { sent, store } = fakeR2((request) =>
      request.url.endsWith('/a.jpg') ? new Response(null, { status: 200, headers: { etag: `"${md5(data).toString('hex').toUpperCase()}"` } }) : new Response(null, { status: 404 }),
    )
    assert.equal(await store.md5('a.jpg'), md5(data).toString('hex'))
    assert.equal(await store.md5('b.jpg'), null)
    assert.ok(sent.every((request) => request.method === 'HEAD'))
  })

  test('removing a file that is not there is fine', async () => {
    const { sent, store } = fakeR2(() => new Response(null, { status: 204 }))
    await store.remove('looks/9-abc.jpg')
    assert.equal(sent[0]?.method, 'DELETE')
  })
})

describe('which store', () => {
  const saved = Object.fromEntries([...R2_NAMES, 'PHOTOS_DIR', 'NODE_ENV'].map((name) => [name, process.env[name]]))
  let dir: string
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-which-'))
  })
  after(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await rm(dir, { recursive: true, force: true })
  })

  function setR2(values: Partial<Record<(typeof R2_NAMES)[number], string>>) {
    for (const name of R2_NAMES) {
      const value = values[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }

  test('no R2 settings is the folder, all four is R2, some is an error', () => {
    process.env.PHOTOS_DIR = dir
    setR2({})
    assert.equal(files().kind, 'folder')
    assert.equal(files().where, dir)

    setR2({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' })
    assert.equal(files().kind, 'r2')
    assert.equal(files().where, 'R2 bucket d')

    setR2({ R2_ACCOUNT_ID: 'a', R2_BUCKET: 'd' })
    assert.throws(() => files(), StorageConfigError)
    assert.throws(() => files(), /R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY are missing/)
  })

  test('the health check writes and reads back, and a folder in production fails', async () => {
    process.env.PHOTOS_DIR = dir
    setR2({})
    Object.assign(process.env, { NODE_ENV: 'test' })
    assert.deepEqual(await checkFiles(), { ok: true, detail: `${dir} is writable` })

    Object.assign(process.env, { NODE_ENV: 'production' })
    const production = await checkFiles()
    assert.equal(production.ok, false)
    assert.match(production.detail, /R2 is not set up/)

    setR2({ R2_ACCOUNT_ID: 'a' })
    assert.equal((await checkFiles()).ok, false)
  })

  test('content types follow the extension', () => {
    assert.equal(contentTypeOf('a.jpg'), 'image/jpeg')
    assert.equal(contentTypeOf('a.thumb.JPEG'), 'image/jpeg')
    assert.equal(contentTypeOf('a.png'), 'image/png')
    assert.equal(contentTypeOf('a'), 'application/octet-stream')
  })
})

describe('the move', () => {
  let root: string
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'wardrobe-move-'))
  })
  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('lists every file as a key, skipping hidden files and health probes', async () => {
    const dir = path.join(root, 'list')
    await mkdir(path.join(dir, 'try-ons'), { recursive: true })
    await mkdir(path.join(dir, 'health'), { recursive: true })
    await writeFile(path.join(dir, 'a.jpg'), 'a')
    await writeFile(path.join(dir, 'a.thumb.jpg'), 'a thumb')
    await writeFile(path.join(dir, 'try-ons', '1-x.jpg'), 'try-on')
    await writeFile(path.join(dir, '.DS_Store'), 'junk')
    await writeFile(path.join(dir, 'health', '1-2.txt'), 'ok')
    assert.deepEqual(await folderKeys(dir), ['a.jpg', 'a.thumb.jpg', 'try-ons/1-x.jpg'])
    assert.deepEqual(await folderKeys(path.join(root, 'never-made')), [])
  })

  test('copies, skips what is already there, checks each copy and prunes only verified files', async () => {
    const from = folderStore(path.join(root, 'from'))
    const to = folderStore(path.join(root, 'to'))
    await from.put('a.jpg', Buffer.from('a'))
    await from.put('wardrobe/b.jpg', Buffer.from('b'))
    await from.put('looks/c.jpg', Buffer.from('c'))
    await to.put('a.jpg', Buffer.from('a'))
    await to.put('looks/c.jpg', Buffer.from('stale'))

    const first = await copyFiles(['a.jpg', 'looks/c.jpg', 'wardrobe/b.jpg'], from, to, { prune: false })
    assert.deepEqual(first, { copied: 2, already: 1, pruned: 0, failed: [] })
    assert.deepEqual(await to.get('looks/c.jpg'), Buffer.from('c'), 'a different file is replaced')
    assert.deepEqual(await from.get('a.jpg'), Buffer.from('a'), 'nothing is deleted without prune')

    // A target that loses bytes: the file is reported and its source kept.
    const lossy: FileStore = { ...to, put: (key, data) => to.put(key, data.subarray(1)) }
    await from.put('d.jpg', Buffer.from('dd'))
    const second = await copyFiles(['a.jpg', 'd.jpg', 'gone.jpg'], from, lossy, { prune: true })
    assert.equal(second.already, 1)
    assert.equal(second.pruned, 1)
    assert.deepEqual(second.failed.map((failure) => failure.key), ['d.jpg', 'gone.jpg'])
    assert.equal(await from.get('a.jpg'), null, 'a verified file is pruned')
    assert.deepEqual(await from.get('d.jpg'), Buffer.from('dd'), 'a failed file is kept')

    // The damaged copy is replaced by the next run, since its MD5 differs.
    assert.deepEqual(await copyFiles(['d.jpg'], from, to, { prune: false }), { copied: 1, already: 0, pruned: 0, failed: [] })
    assert.deepEqual(await missingKeys(['wardrobe/b.jpg', 'a.jpg', 'nope.jpg', 'd.jpg'], to), ['nope.jpg'])
  })
})
