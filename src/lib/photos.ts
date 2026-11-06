import { createHash } from 'node:crypto'

import sharp, { type OutputInfo } from 'sharp'

import { db, type Sql } from './db.ts'
import { files } from './storage.ts'

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

export type Normalised = { master: { data: Buffer; info: OutputInfo }; thumb: Buffer; sha256: string }

/** The type and size rules every upload follows, his photos and his clothes alike. */
export function checkUpload(input: { bytes: Buffer; mime: string }): void {
  if (!ACCEPTED_MIMES.includes(input.mime)) {
    throw new PhotoError('Use a JPEG, PNG, WebP or HEIC photo.')
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new PhotoError('Photos must be under 20 MB.')
  }
}

/**
 * An upload as a master JPEG and a thumb, both without metadata. sharp's
 * rotate() bakes the EXIF orientation in, and the output carries no location,
 * device or timestamp. The hash is of the master, for the file name.
 */
export async function normaliseImage(bytes: Buffer): Promise<Normalised> {
  let master: { data: Buffer; info: OutputInfo }
  let thumb: Buffer
  try {
    const source = sharp(bytes, { failOn: 'none' }).rotate()
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
  return { master, thumb, sha256: createHash('sha256').update(master.data).digest('hex') }
}

/**
 * Normalise an upload into two stored JPEGs (src/lib/storage.ts) and one row in profile_photos.
 * The file name is the content hash, so the same photo uploaded twice is one
 * file and one row.
 */
export async function storePhoto(input: { bytes: Buffer; mime: string; kind: PhotoKind }): Promise<Photo> {
  checkUpload(input)

  const { master, thumb, sha256 } = await normaliseImage(input.bytes)
  const name = sha256.slice(0, 24)
  const relative = `${name}.jpg`

  await storePair(relative, master.data, thumb)

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
  return files().get(variant === 'thumb' ? thumbName(row.path) : row.path)
}

/** Base64 of the master file, which is what Claude is sent. */
export async function photoBase64(photo: Pick<Photo, 'path'>): Promise<string> {
  const bytes = await files().get(photo.path)
  if (!bytes) throw new PhotoError('A photo is missing its file. Delete it and add it again.')
  return bytes.toString('base64')
}

/** One photo, and every try-on made from it. */
export async function removePhoto(id: number, sql: Sql = db()): Promise<void> {
  const [row] = await sql<{ id: number; path: string }[]>`
    update profile_photos set deleted_at = now()
    where id = ${id} and deleted_at is null
    returning id::int as id, path
  `
  if (!row) return
  await removePair(row.path)
  await removeTryOns(sql, [row.id])
}

/**
 * "Delete photos, keep the derived profile." The try-ons go too, since each is
 * a picture of him; their rows stay, without the files, so what they cost is
 * still counted.
 */
export async function removeAllPhotos(sql: Sql = db()): Promise<{ photos: number; tryOns: number }> {
  const rows = await sql<{ id: number; path: string }[]>`
    update profile_photos set deleted_at = now()
    where deleted_at is null
    returning id::int as id, path
  `
  await Promise.all(rows.map((row) => removePair(row.path)))
  // Every try-on, not only those of the photos just deleted: one made from a
  // photo deleted earlier is still a picture of him.
  const tryOns = await removeTryOns(sql, null)
  return { photos: rows.length, tryOns }
}

/**
 * Try-on images made from these photos (or all, for null). A try-on still in
 * the making is marked failed; makeTryOn will not file an image for a deleted
 * photo.
 */
async function removeTryOns(sql: Sql, photoIds: number[] | null): Promise<number> {
  const rows = await sql<{ path: string | null }[]>`
    with gone as (
      select id, path from try_ons
      where deleted_at is null
        ${photoIds === null ? sql`` : sql`and photo_id = any (${photoIds}::bigint[])`}
      for update
    )
    update try_ons t set deleted_at = now(), path = null,
      status = case when t.status = 'making' then 'failed' else t.status end,
      error = case when t.status = 'making' then 'The photo was deleted.' else t.error end,
      finished_at = coalesce(t.finished_at, now())
    from gone where t.id = gone.id
    returning gone.path
  `
  await Promise.all(rows.flatMap((row) => (row.path ? [files().remove(row.path)] : [])))
  // Images deleted; a failed request had none.
  return rows.filter((row) => row.path).length
}

/** A master and its thumb, both JPEGs. */
export async function storePair(relative: string, master: Buffer, thumb: Buffer): Promise<void> {
  await Promise.all([files().put(relative, master, 'image/jpeg'), files().put(thumbName(relative), thumb, 'image/jpeg')])
}

/** A master and its thumb, gone. One already missing is fine. */
export async function removePair(relative: string): Promise<void> {
  await Promise.all([files().remove(relative), files().remove(thumbName(relative))])
}

export function thumbName(relative: string): string {
  return relative.replace(/\.jpg$/, '.thumb.jpg')
}
