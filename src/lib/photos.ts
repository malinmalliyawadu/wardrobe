import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp, { type OutputInfo } from 'sharp'

import { db } from './db.ts'

export const PHOTO_KINDS = ['face', 'full_body', 'reference'] as const
export type PhotoKind = (typeof PHOTO_KINDS)[number]

export type Photo = {
  id: number
  kind: PhotoKind
  path: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  sha256: string
  created_at: Date
}

/** Longest edge Claude reads without downscaling; also plenty for a phone screen. */
export const MASTER_EDGE = 1568
export const THUMB_EDGE = 480
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const ACCEPTED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export class PhotoError extends Error {}

/*
 * Photos live on a volume outside the app (PHOTOS_DIR), so the bundler must not
 * try to trace these paths: without the turbopackIgnore hints it treats every
 * runtime path as a reference into the project and copies the whole repository
 * into the server output.
 */
export function photosDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.PHOTOS_DIR ?? './data/photos')
}

function photoPath(file: string): string {
  return path.join(/*turbopackIgnore: true*/ photosDir(), file)
}

/**
 * Normalise an upload into two JPEGs on disk and one row in profile_photos.
 *
 * sharp's rotate() bakes the EXIF orientation in, so Claude never sees a
 * sideways photo, and the output carries no metadata at all: no location, no
 * device, no timestamp. The file name is the content hash, so the same photo
 * uploaded twice is one file and one row.
 */
export async function storePhoto(input: { bytes: Buffer; mime: string; kind: PhotoKind }): Promise<Photo> {
  if (!ACCEPTED_MIMES.includes(input.mime)) {
    throw new PhotoError('Use a JPEG, PNG, WebP or HEIC photo.')
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new PhotoError('Photos must be under 20 MB.')
  }

  let master: { data: Buffer; info: OutputInfo }
  let thumb: Buffer
  try {
    const source = sharp(input.bytes, { failOn: 'none' }).rotate()
    master = await source
      .clone()
      .resize({ width: MASTER_EDGE, height: MASTER_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    thumb = await sharp(master.data)
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()
  } catch {
    throw new PhotoError('That file could not be read as a photo.')
  }

  const sha256 = createHash('sha256').update(master.data).digest('hex')
  const name = sha256.slice(0, 24)
  const relative = `${name}.jpg`

  await mkdir(/*turbopackIgnore: true*/ photosDir(), { recursive: true })
  await writeFile(/*turbopackIgnore: true*/ photoPath(relative), master.data)
  await writeFile(/*turbopackIgnore: true*/ photoPath(thumbName(relative)), thumb)

  const [row] = await db()<Photo[]>`
    insert into profile_photos (kind, path, mime, bytes, width, height, sha256)
    values (${input.kind}, ${relative}, 'image/jpeg', ${master.info.size},
            ${master.info.width}, ${master.info.height}, ${sha256})
    on conflict (path) do update
      set kind = excluded.kind, deleted_at = null
    returning id, kind, path, mime, bytes, width, height, sha256, created_at
  `
  if (!row) throw new Error('insert returned no row')
  return row
}

export async function listPhotos(): Promise<Photo[]> {
  return db()<Photo[]>`
    select id, kind, path, mime, bytes, width, height, sha256, created_at
    from profile_photos
    where deleted_at is null
    order by array_position(array['face', 'full_body', 'reference'], kind), created_at
  `
}

export async function photoFile(id: number, variant: 'master' | 'thumb'): Promise<Buffer | null> {
  const [row] = await db()<{ path: string }[]>`
    select path from profile_photos where id = ${id} and deleted_at is null
  `
  if (!row) return null
  const file = variant === 'thumb' ? thumbName(row.path) : row.path
  try {
    return await readFile(/*turbopackIgnore: true*/ photoPath(file))
  } catch {
    return null
  }
}

/** Base64 of the master file, which is what Claude is sent. */
export async function photoBase64(photo: Pick<Photo, 'path'>): Promise<string> {
  const bytes = await readFile(/*turbopackIgnore: true*/ photoPath(photo.path))
  return bytes.toString('base64')
}

export async function removePhoto(id: number): Promise<void> {
  const [row] = await db()<{ path: string }[]>`
    update profile_photos set deleted_at = now()
    where id = ${id} and deleted_at is null
    returning path
  `
  if (row) await unlinkPair(row.path)
}

/** "Delete photos, keep the derived profile." */
export async function removeAllPhotos(): Promise<number> {
  const rows = await db()<{ path: string }[]>`
    update profile_photos set deleted_at = now()
    where deleted_at is null
    returning path
  `
  await Promise.all(rows.map((row) => unlinkPair(row.path)))
  return rows.length
}

async function unlinkPair(relative: string): Promise<void> {
  await Promise.all(
    [relative, thumbName(relative)].map((file) =>
      unlink(/*turbopackIgnore: true*/ photoPath(file)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      }),
    ),
  )
}

function thumbName(relative: string): string {
  return relative.replace(/\.jpg$/, '.thumb.jpg')
}
