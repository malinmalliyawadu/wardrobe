import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import sharp from 'sharp'

import { connect } from '../src/lib/db.ts'

/*
 * Exercises the real pipeline: sharp, the file system and profile_photos.
 * Needs DATABASE_URL and uses a throwaway PHOTOS_DIR. Rows it creates are
 * hard-deleted at the end so the test leaves nothing behind.
 */

let dir: string
let sql: ReturnType<typeof connect>
const created: number[] = []

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the photo test')
  dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-photos-'))
  process.env.PHOTOS_DIR = dir
  sql = connect({ max: 1 })
})

after(async () => {
  // Hard delete, not the soft delete the app does, so nothing is left behind.
  if (created.length) await sql`delete from profile_photos where id = any(${created})`
  await sql.end()
  await rm(dir, { recursive: true, force: true })
})

async function samplePhoto(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 140, b: 100 } } })
    .jpeg()
    .toBuffer()
}

test('a large upload is resized to the master edge, thumbnailed, stripped and deduplicated', async () => {
  const { storePhoto, listPhotos, removePhoto, MASTER_EDGE, THUMB_EDGE } = await import('../src/lib/photos.ts')
  const bytes = await samplePhoto(3000, 4000)

  const photo = await storePhoto({ bytes, mime: 'image/jpeg', kind: 'reference' })
  created.push(photo.id)
  assert.equal(photo.kind, 'reference')
  assert.equal(photo.height, MASTER_EDGE)
  assert.ok(photo.width !== null && photo.width < MASTER_EDGE)

  const files = await readdir(dir)
  assert.ok(files.includes(photo.path))
  assert.ok(files.includes(photo.path.replace(/\.jpg$/, '.thumb.jpg')))

  const thumb = await sharp(path.join(dir, photo.path.replace(/\.jpg$/, '.thumb.jpg'))).metadata()
  assert.equal(thumb.height, THUMB_EDGE)
  const master = await sharp(path.join(dir, photo.path)).metadata()
  assert.equal(master.exif, undefined, 'metadata must be stripped')

  const again = await storePhoto({ bytes, mime: 'image/jpeg', kind: 'reference' })
  assert.equal(again.id, photo.id, 'same bytes, same row')

  const listed = await listPhotos()
  assert.ok(listed.some((p) => p.id === photo.id))

  await removePhoto(photo.id)
  const afterRemove = await readdir(dir)
  assert.ok(!afterRemove.includes(photo.path), 'file removed')
  assert.ok(!(await listPhotos()).some((p) => p.id === photo.id), 'row hidden')
})

test('junk and oversized uploads are refused with a message for the screen', async () => {
  const { storePhoto, PhotoError, MAX_UPLOAD_BYTES } = await import('../src/lib/photos.ts')
  await assert.rejects(
    storePhoto({ bytes: Buffer.from('not an image'), mime: 'image/jpeg', kind: 'face' }),
    (error: unknown) => error instanceof PhotoError && /could not be read/.test(error.message),
  )
  await assert.rejects(
    storePhoto({ bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1), mime: 'image/jpeg', kind: 'face' }),
    (error: unknown) => error instanceof PhotoError && /20 MB/.test(error.message),
  )
  await assert.rejects(
    storePhoto({ bytes: Buffer.alloc(10), mime: 'application/pdf', kind: 'face' }),
    (error: unknown) => error instanceof PhotoError,
  )
})
