import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import sharp from 'sharp'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { getWishlist, recordAction } from '../src/lib/feed.ts'
import { findPhotoSrc, storeFindPhoto } from '../src/lib/find-photos.ts'
import type { PoliteClient } from '../src/lib/finder/http.ts'
import { refreshSaved } from '../src/lib/finder/product-link.ts'
import { listRetailers, PHOTO_PLATFORM } from '../src/lib/retailers.ts'
import { addPhotoWish, buildWishReadRequest, PhotoWishError, WishReadSchema, wishValuesFromRead, type WishRead } from '../src/lib/wish-photo.ts'

/*
 * Wishes from a photo, with no link (migration 0025): against a real Postgres
 * in a scratch database (never the one DATABASE_URL names) and a throwaway
 * PHOTOS_DIR. Claude is never called; the read is checked as a request and
 * as the values it leaves in the form.
 */

const scratch = `wardrobe_photo_wish_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql
let dir: string

const noNetwork = {
  json: () => assert.fail('a wish from a photo was read from somewhere'),
  text: () => assert.fail('a wish from a photo was read from somewhere'),
} as unknown as PoliteClient

async function photo(colour: string) {
  const bytes = await sharp({ create: { width: 900, height: 1200, channels: 3, background: colour } }).png().toBuffer()
  return storeFindPhoto({ bytes, mime: 'image/png' }, sql)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the photo wishes test')
  admin = connect({ max: 1 })
  await admin.unsafe(`create database ${scratch}`)
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `/${scratch}`
  execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
  process.env.DATABASE_URL = url.toString()
  dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-wishes-'))
  process.env.PHOTOS_DIR = dir
  sql = connect({ max: 2 })
})

after(async () => {
  await db().end()
  await sql?.end()
  await admin.unsafe(`drop database if exists ${scratch} with (force)`)
  await admin.end()
  await rm(dir, { recursive: true, force: true })
})

test('the From a photo store exists, switched off, and is never offered as a shop', async () => {
  const [store] = await sql<{ enabled: boolean; currency: string }[]>`select enabled, currency from retailers where platform = ${PHOTO_PLATFORM}`
  assert.deepEqual(store, { enabled: false, currency: 'NZD' })
  assert.equal((await listRetailers(sql)).some((retailer) => retailer.platform === (PHOTO_PLATFORM as string)), false)
})

test('a wish with no price is a product with his photo and no variant, on the wishlist, never checked', async () => {
  const first = await photo('#2b3a2e')
  const id = await addPhotoWish(sql, {
    photo_id: first.id,
    name: 'Bottle green chore jacket',
    garment_type: 'overshirt',
    price: null,
    shop: null,
    colour_hex: '#2f4a3a',
  })
  const [product] = await sql<{ url: string; vendor: string | null; garment_type: string; find_photo_id: number; image_colours: string[]; variants: number }[]>`
    select p.url, p.vendor, p.garment_type, p.find_photo_id::int as find_photo_id, p.image_colours,
           (select count(*)::int from product_variants v where v.product_id = p.id) as variants
    from products p where p.id = ${id}
  `
  assert.deepEqual(product, {
    url: findPhotoSrc(first.id),
    vendor: null,
    garment_type: 'overshirt',
    find_photo_id: first.id,
    image_colours: ['#2f4a3a'],
    variants: 0,
  })

  await recordAction({ action: 'saved', product_id: id, slot_id: null }, sql)
  const saved = (await getWishlist()).saved.find((find) => find.product_id === id)
  assert.ok(saved)
  assert.equal(saved.fromPhoto, true)
  assert.equal(saved.priced, false)
  assert.equal(saved.inStock, true, 'never checked, so never out of stock')
  assert.equal(saved.title, 'Bottle green chore jacket')

  const stats = await refreshSaved(sql, noNetwork, await listRetailers(sql), new Date(Date.now() + 60_000))
  assert.deepEqual(stats, { checked: 0, removed: 0, failed: 0 })

  // The same photo again, now with a price and the shop: the same wish, updated.
  const again = await addPhotoWish(sql, {
    photo_id: first.id,
    name: 'Bottle green chore jacket',
    garment_type: 'overshirt',
    price: 289,
    shop: 'Crane Brothers',
    colour_hex: null,
  })
  assert.equal(again, id)
  const updated = (await getWishlist()).saved.find((find) => find.product_id === id)
  assert.ok(updated)
  assert.equal(updated.priced, true)
  assert.equal(updated.price.nzdCents, 28900)
  assert.equal(updated.vendor, 'Crane Brothers')
})

test('bought, a wish from a photo is a piece, in the read colour', async () => {
  const id = await addPhotoWish(sql, {
    photo_id: (await photo('#7a4a2a')).id,
    name: 'Rust suede loafers',
    garment_type: 'shoes',
    price: 320,
    shop: null,
    colour_hex: '#8a4b2b',
  })
  await recordAction({ action: 'saved', product_id: id, slot_id: null }, sql)
  await recordAction({ action: 'bought', product_id: id, slot_id: null }, sql)
  const [piece] = await sql<{ name: string; garment_type: string; colour_hex: string; source: string }[]>`
    select name, garment_type, colour_hex, source from wardrobe_pieces where product_id = ${id}
  `
  assert.deepEqual(piece, { name: 'Rust suede loafers', garment_type: 'shoes', colour_hex: '#8a4b2b', source: 'find' })
})

test('a photo that has gone is refused', async () => {
  await assert.rejects(
    addPhotoWish(sql, { photo_id: 999_999, name: 'Gone', garment_type: 'tee', price: null, shop: null, colour_hex: null }),
    PhotoWishError,
  )
})

test('the read fills the form: a price only in NZD, a palette colour only when it is in the guide', () => {
  const guide = { palette: { best: [{ hex: '#2f4a3a', name: 'Bottle green' }], neutrals: [], avoid: [] } } as never
  const read: WishRead = {
    is_garment: true,
    name: 'bottle green chore jacket',
    garment_type: 'overshirt',
    palette_hex: '#2F4A3A',
    shop: ' Crane Brothers ',
    price: 289,
    currency: 'NZD',
  }
  assert.deepEqual(wishValuesFromRead(read, guide), {
    name: 'Bottle green chore jacket',
    garment_type: 'overshirt',
    price: '289',
    shop: 'Crane Brothers',
    colour_hex: '#2f4a3a',
  })
  const foreign = wishValuesFromRead({ ...read, currency: 'AUD', palette_hex: '#123456' }, guide)
  assert.equal(foreign.price, '', 'an AUD price is not passed off as NZD')
  assert.equal(foreign.colour_hex, '', 'a colour not in the guide is dropped')
  assert.deepEqual(wishValuesFromRead(null, guide), {})
})

test('the read request sends the photo and the palette to Sonnet with the schema', () => {
  const guide = { palette: { best: [{ hex: '#2f4a3a', name: 'Bottle green' }], neutrals: [], avoid: [] } } as never
  const request = buildWishReadRequest('AAAA', guide)
  assert.match(request.model, /sonnet/)
  const [image, words] = request.messages[0]!.content
  assert.equal(image?.type, 'image')
  assert.ok(words?.type === 'text' && words.text.includes('#2f4a3a'))
  assert.ok(WishReadSchema.safeParse({ is_garment: true, name: 'x', garment_type: 'tee', palette_hex: null, shop: null, price: null, currency: null }).success)
})
