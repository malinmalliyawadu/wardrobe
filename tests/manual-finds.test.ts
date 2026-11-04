import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import sharp from 'sharp'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { getFeed, recordAction } from '../src/lib/feed.ts'
import { clearFindOrphans, findPhotoId, findPhotoSrc, storeFindPhoto } from '../src/lib/find-photos.ts'
import type { PoliteClient } from '../src/lib/finder/http.ts'
import { addManualFind, ManualFindError, manualExternalId } from '../src/lib/finder/manual.ts'
import { addProductFromLink, ManualStoreError, refreshSaved, storeForLink } from '../src/lib/finder/product-link.ts'
import { storeCounts } from '../src/lib/finder/settings.ts'
import { listRetailers, readable, RetailerFileSchema, seedRetailers, type Retailer } from '../src/lib/retailers.ts'
import { fetchProductImage } from '../src/lib/try-on.ts'

/*
 * Finds added by hand, from a store whose site cannot be read (Lululemon):
 * against a real Postgres in a scratch database (never the one DATABASE_URL
 * names) and a throwaway PHOTOS_DIR. Nothing is fetched from anywhere.
 */

const scratch = `wardrobe_manual_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql
let dir: string
let lululemon: Retailer

/** A client that fails the test if anything tries to read a store. */
const noNetwork = {
  json: () => assert.fail('a store that cannot be read was read'),
  text: () => assert.fail('a store that cannot be read was read'),
} as unknown as PoliteClient

const LINK = 'https://www.lululemon.co.nz/en-nz/p/mens-joggers/License-to-Train-Jogger/_/prod11460025.html?dwvar_prod11460025_color=0001'

async function photo(colour: string) {
  const bytes = await sharp({ create: { width: 800, height: 1000, channels: 3, background: colour } }).png().toBuffer()
  return storeFindPhoto({ bytes, mime: 'image/png' }, sql)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the manual finds test')
  admin = connect({ max: 1 })
  await admin.unsafe(`create database ${scratch}`)
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `/${scratch}`
  execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
  process.env.DATABASE_URL = url.toString()
  dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-finds-'))
  process.env.PHOTOS_DIR = dir
  sql = connect({ max: 2 })

  const file = RetailerFileSchema.parse(JSON.parse(await readFile(new URL('../data/retailers.json', import.meta.url), 'utf8')))
  const seed = file.retailers.find((store) => store.slug === 'lululemon')
  assert.ok(seed, 'Lululemon is in data/retailers.json')
  await seedRetailers(sql, [seed])
  lululemon = (await listRetailers(sql)).find((store) => store.slug === 'lululemon')!
})

after(async () => {
  await db().end()
  await sql?.end()
  await admin.unsafe(`drop database if exists ${scratch} with (force)`)
  await admin.end()
  await rm(dir, { recursive: true, force: true })
})

test('Lululemon is a store added by hand: never read, never walked, no switch, no unverified store shown', async () => {
  assert.deepEqual([lululemon.platform, lululemon.enabled, lululemon.currency, lululemon.ships_to_nz], ['manual', false, 'NZD', true])
  assert.equal(readable(lululemon), false)
  assert.equal(lululemon.wellington_store, null)
  assert.equal((await storeCounts(sql)).some((store) => store.slug === 'lululemon'), false, 'no switch on /you/finder')

  assert.equal(storeForLink([lululemon], LINK).retailer.slug, 'lululemon')
  await assert.rejects(
    addProductFromLink(sql, noNetwork, [lululemon], LINK),
    (error: unknown) => error instanceof ManualStoreError && /cannot be read automatically/.test(error.message),
    'a pasted link is never fetched',
  )
})

test('one find per page and colour; the query string is not part of it', () => {
  const url = new URL(LINK)
  assert.equal(manualExternalId(url, 'Black'), 'lululemon.co.nz/en-nz/p/mens-joggers/License-to-Train-Jogger/_/prod11460025.html#black')
  assert.equal(manualExternalId(new URL(`${LINK}&utm_source=x`), ' black '), manualExternalId(url, 'Black'))
  assert.notEqual(manualExternalId(url, 'Navy'), manualExternalId(url, 'Black'))
  assert.equal(manualExternalId(new URL('https://lululemon.co.nz/a/b/'), null), 'lululemon.co.nz/a/b')
})

test('a find added by hand is a product with his photo, price, colour and size, and updates when added again', async () => {
  const url = new URL(LINK)
  const find = { name: 'License to Train Jogger', garment_type: 'trousers' as const, price: 149, colour: 'Black', size: 'M' }
  await assert.rejects(addManualFind(sql, lululemon, url, { ...find, photo_id: null }), ManualFindError, 'the first add needs a photo')

  const first = await photo('#222222')
  assert.equal(first.width, 800)
  const id = await addManualFind(sql, lululemon, url, { ...find, photo_id: first.id })
  const read = async (productId: number) =>
    (
      await sql<
        {
          title: string
          vendor: string
          url: string
          garment_type: string
          menswear: boolean
          image: { src: string; width: number; height: number }
          find_photo_id: number
          variants: { option_size: string; option_colour: string; price_cents: number; available: boolean; size_key: string | null }[]
        }[]
      >`
        select p.title, p.vendor, p.url, p.garment_type, p.menswear, p.images -> 0 as image, p.find_photo_id::int as find_photo_id,
               json_agg(json_build_object('option_size', v.option_size, 'option_colour', v.option_colour,
                 'price_cents', v.price_cents, 'available', v.available, 'size_key', v.size_key)) as variants
        from products p join product_variants v on v.product_id = p.id
        where p.id = ${productId} group by p.id
      `
    )[0]!
  const stored = await read(id)
  assert.deepEqual(
    { ...stored, image: { src: stored.image.src, width: stored.image.width, height: stored.image.height } },
    {
      title: 'License to Train Jogger',
      vendor: 'Lululemon',
      url: LINK,
      garment_type: 'trousers',
      menswear: true,
      image: { src: findPhotoSrc(first.id), width: 800, height: 1000 },
      find_photo_id: first.id,
      variants: [{ option_size: 'M', option_colour: 'Black', price_cents: 14900, available: true, size_key: 'M' }],
    },
  )
  assert.equal(findPhotoId(stored.image.src), first.id)

  // The same link and colour again, on sale, without a new photo: the same find, the photo kept.
  const again = await addManualFind(sql, lululemon, url, { ...find, price: 99, photo_id: null })
  assert.equal(again, id)
  const updated = await read(id)
  assert.equal(updated.variants[0]!.price_cents, 9900)
  assert.equal(updated.find_photo_id, first.id)
  const [{ observations } = { observations: 0 }] = await sql<{ observations: number }[]>`
    select count(*)::int as observations from price_observations o
    join product_variants v on v.id = o.variant_id where v.product_id = ${id}
  `
  assert.equal(observations, 2, 'the new price is recorded like any price change')

  // Another colour of the same page is a find of its own.
  const navy = await addManualFind(sql, lululemon, url, { ...find, colour: 'Navy', photo_id: (await photo('#1f2a44')).id })
  assert.notEqual(navy, id)
})

test('on Saved it is marked as added by hand, keeps his size, is never read at night, and can be bought', async () => {
  const shirt = await addManualFind(sql, lululemon, new URL('https://www.lululemon.co.nz/en-nz/p/metal-vent-tech/_/prod1.html'), {
    name: 'Metal Vent Tech Short-Sleeve Shirt',
    garment_type: 'tee',
    price: 89,
    colour: null,
    size: 'L',
    photo_id: (await photo('#556b2f')).id,
  })
  await recordAction({ action: 'saved', product_id: shirt, slot_id: null }, sql)
  const [action] = await sql<{ price_cents: number; size: string }[]>`
    select price_cents, size from feed_actions where product_id = ${shirt} order by id desc limit 1
  `
  assert.deepEqual(action, { price_cents: 8900, size: 'L' }, 'saved at his price, in his size')

  const saved = (await getFeed()).saved.find((find) => find.product_id === shirt)
  assert.ok(saved)
  assert.equal(saved.byHand, true)
  assert.equal(saved.retailer, 'Lululemon')
  assert.equal(saved.inStock, true)
  assert.deepEqual(saved.sizes, ['L'])
  assert.equal(saved.price.nzdCents, 8900)
  assert.equal(saved.image?.src.startsWith('/photos/finds/'), true)

  // The nightly refresh of saved finds passes it by: its store cannot be read.
  const stats = await refreshSaved(sql, noNetwork, await listRetailers(sql), new Date(Date.now() + 60_000))
  assert.equal(stats.failed, 0)
  const [{ removed } = { removed: true }] = await sql<{ removed: boolean }[]>`select removed_at is not null as removed from products where id = ${shirt}`
  assert.equal(removed, false)

  await recordAction({ action: 'bought', product_id: shirt, slot_id: null }, sql)
  const [piece] = await sql<{ name: string; garment_type: string; size: string; source: string }[]>`
    select name, garment_type, size, source from wardrobe_pieces where product_id = ${shirt}
  `
  assert.ok(piece, 'bought, it is a piece in the wardrobe')
  assert.equal(piece.garment_type, 'tee')
  assert.equal(piece.size, 'L')
})

test('its photo is read from our own volume for a try-on, and a photo no find uses is cleared after a day', async () => {
  const used = await photo('#8b4513')
  await addManualFind(sql, lululemon, new URL('https://www.lululemon.co.nz/en-nz/p/abc/_/prod2.html'), {
    name: 'ABC Jogger',
    garment_type: 'trousers',
    price: 169,
    colour: 'Rust',
    size: null,
    photo_id: used.id,
  })
  const jpeg = await fetchProductImage(findPhotoSrc(used.id), () => assert.fail('our own photo is never fetched'))
  assert.equal((await sharp(jpeg).metadata()).format, 'jpeg')

  const unused = await photo('#c0c0c0')
  assert.equal(await clearFindOrphans(sql), 0, 'a photo just chosen is kept while he fills in the form')
  await sql`update find_photos set created_at = now() - interval '2 days' where id in ${sql([used.id, unused.id])}`
  assert.equal(await clearFindOrphans(sql), 1)
  const ids = (await sql<{ id: number }[]>`select id::int as id from find_photos`).map((row) => row.id)
  assert.ok(ids.includes(used.id) && !ids.includes(unused.id))
  const files = await readdir(path.join(dir, 'finds'))
  assert.equal(files.length, ids.length * 2, 'a master and a thumb for each photo still kept')
})
