import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import sharp from 'sharp'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { getWishlist, recordAction } from '../src/lib/feed.ts'
import { clearFindOrphans, findPhotoId, findPhotoSrc, storeFindPhoto } from '../src/lib/find-photos.ts'
import { writePage } from '../src/lib/finder/ingest.ts'
import { addManualFind } from '../src/lib/finder/manual.ts'
import { normaliseProduct, ShopifyProductSchema } from '../src/lib/finder/shopify.ts'
import { addOwnProductPhoto, chooseProductPhoto, ProductPhotoError, productPhotos } from '../src/lib/product-photos.ts'
import { listRetailers, RetailerFileSchema, seedRetailers } from '../src/lib/retailers.ts'

/*
 * The photo a product shows (migration 0020): one of the shop's he chose, or
 * his own, held across the nightly rewrite. Against a real Postgres in a
 * scratch database (never the one DATABASE_URL names) and a throwaway
 * PHOTOS_DIR. Nothing is fetched from anywhere.
 */

const scratch = `wardrobe_product_photos_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql
let dir: string
let shop: number

const local = { base_url: 'https://photos.test', catalogue: 'menswear' as const }
const shot = (n: number, v = 1) => `https://cdn.shopify.com/s/files/overshirt-${n}.jpg?v=${v}`

/** The overshirt as the shop lists it, with its photos in the order given. */
function overshirt(photos: string[]) {
  return normaliseProduct(
    ShopifyProductSchema.parse({
      id: 501,
      title: 'Cord Overshirt',
      handle: 'cord-overshirt',
      product_type: 'Shirts',
      tags: [],
      options: [{ name: 'Size', position: 1, values: ['M'] }],
      variants: [{ id: 502, option1: 'M', price: '149.00', available: true }],
      images: photos.map((src) => ({ src, width: 1000, height: 1250 })),
    }),
    local,
  )
}

async function overshirtId(): Promise<number> {
  const [row] = await sql<{ id: number }[]>`select id::int as id from products where external_id = '501'`
  return row!.id
}

async function shown(id: number): Promise<string | null> {
  const [row] = await sql<{ src: string | null }[]>`select main_image ->> 'src' as src from products where id = ${id}`
  return row!.src
}

async function photo(colour: string) {
  const bytes = await sharp({ create: { width: 800, height: 1000, channels: 3, background: colour } }).png().toBuffer()
  return { bytes, mime: 'image/png' }
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the product photos test')
  admin = connect({ max: 1 })
  await admin.unsafe(`create database ${scratch}`)
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `/${scratch}`
  execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
  process.env.DATABASE_URL = url.toString()
  dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-product-photos-'))
  process.env.PHOTOS_DIR = dir
  sql = connect({ max: 2 })

  const [row] = await sql<{ id: number }[]>`
    insert into retailers (slug, name, platform, base_url, country, currency, catalogue)
    values ('photos', 'Photos', 'shopify', ${local.base_url}, 'NZ', 'NZD', 'menswear')
    returning id::int as id
  `
  shop = row!.id
  await writePage(sql, shop, [overshirt([shot(1), shot(2), shot(3)])])
})

after(async () => {
  await db().end()
  await sql?.end()
  await admin.unsafe(`drop database if exists ${scratch} with (force)`)
  await admin.end()
  await rm(dir, { recursive: true, force: true })
})

test('a product shows the shop’s first photo until he chooses another, and the choice outlives the nightly rewrite', async () => {
  const id = await overshirtId()
  const before = await productPhotos(id, sql)
  assert.deepEqual(before?.photos.map((image) => image.src), [shot(1), shot(2), shot(3)])
  assert.equal(before?.shown, shot(1))

  const chosen = await chooseProductPhoto(id, shot(3), sql)
  assert.equal(chosen.src, shot(3))
  assert.equal(await shown(id), shot(3))

  // The shop reorders its photos and adds one: his choice holds.
  await writePage(sql, shop, [overshirt([shot(4), shot(1), shot(2), shot(3)])])
  assert.equal(await shown(id), shot(3))

  // Choosing the shop's first is no choice: it follows the shop again.
  await chooseProductPhoto(id, shot(4), sql)
  assert.equal((await sql`select chosen_image from products where id = ${id}`)[0]!.chosen_image, null)
  await writePage(sql, shop, [overshirt([shot(2), shot(4)])])
  assert.equal(await shown(id), shot(2))

  await assert.rejects(chooseProductPhoto(id, 'https://elsewhere.test/x.jpg', sql), ProductPhotoError)
  await assert.rejects(chooseProductPhoto(id, findPhotoSrc(999_999), sql), ProductPhotoError)
  await assert.rejects(chooseProductPhoto(999_999, shot(2), sql), ProductPhotoError)
})

test('his own photo is shown in place of the shop’s, is one of the choices, and is kept from the orphan sweep while shown', async () => {
  const id = await overshirtId()
  const own = await addOwnProductPhoto(id, await photo('#5a3d2b'), sql)
  const ownId = findPhotoId(own.src)
  assert.ok(ownId !== null, 'his photo is served from our own volume')
  assert.deepEqual([own.width, own.height], [800, 1000])
  assert.equal(await shown(id), own.src)

  const choices = await productPhotos(id, sql)
  assert.deepEqual(choices?.photos.map((image) => image.src), [shot(2), shot(4), own.src])
  assert.equal(choices?.shown, own.src)

  // On the wishlist it is the photo, and the shop's are still there to go back to.
  await recordAction({ action: 'saved', product_id: id, slot_id: null }, sql)
  const saved = (await getWishlist()).saved.find((find) => find.product_id === id)
  assert.equal(saved?.image?.src, own.src)
  assert.deepEqual(saved?.photos.map((image) => image.src), [shot(2), shot(4), own.src])

  await sql`update find_photos set created_at = now() - interval '2 days'`
  assert.equal(await clearFindOrphans(sql), 0, 'a photo a product shows is kept')

  // Back to the shop's photo: his is no longer shown, so it goes after a day.
  await chooseProductPhoto(id, shot(4), sql)
  assert.equal(await clearFindOrphans(sql), 1)
  assert.equal((await sql`select 1 from find_photos where id = ${ownId}`).length, 0)
  await assert.rejects(chooseProductPhoto(id, own.src, sql), ProductPhotoError, 'a photo that has gone cannot be chosen')
})

test('a find added by hand can show another photo of his, and adding it again with a new photo replaces that choice', async () => {
  const file = RetailerFileSchema.parse(JSON.parse(await readFile(new URL('../data/retailers.json', import.meta.url), 'utf8')))
  await seedRetailers(sql, [file.retailers.find((store) => store.slug === 'lululemon')!])
  const lululemon = (await listRetailers(sql)).find((store) => store.slug === 'lululemon')!
  const url = new URL('https://www.lululemon.co.nz/en-nz/p/abc/_/prod9.html')
  const find = { name: 'ABC Jogger', garment_type: 'trousers' as const, price: 169, colour: null, size: null }

  const first = await storeFindPhoto(await photo('#222222'), sql)
  const id = await addManualFind(sql, lululemon, url, { ...find, photo_id: first.id })
  assert.equal(await shown(id), findPhotoSrc(first.id))

  const other = await addOwnProductPhoto(id, await photo('#777777'), sql)
  assert.equal(await shown(id), other.src)

  // The same link, details changed but no new photo: his choice stands.
  await addManualFind(sql, lululemon, url, { ...find, price: 149, photo_id: null })
  assert.equal(await shown(id), other.src)

  const replaced = await storeFindPhoto(await photo('#aaaaaa'), sql)
  await addManualFind(sql, lululemon, url, { ...find, photo_id: replaced.id })
  assert.equal(await shown(id), findPhotoSrc(replaced.id))
})
