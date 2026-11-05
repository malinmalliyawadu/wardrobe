import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { recordAction } from '../src/lib/feed.ts'
import { PoliteClient } from '../src/lib/finder/http.ts'
import { addProductFromLink, ProductLinkError, refreshSaved } from '../src/lib/finder/product-link.ts'
import { storeCounts } from '../src/lib/finder/settings.ts'
import { listRetailers, RetailerFileSchema, seedRetailers, walkedNightly } from '../src/lib/retailers.ts'

/*
 * Rodd & Gunn links against a real Postgres, in a scratch database made for
 * this file and dropped after it, and a fake of the site serving the saved
 * pages (tests/fixtures/rodd-and-gunn-*). The fake ignores a link's slug and
 * region, as the site does once it has redirected to the canonical page.
 */

const scratch = `wardrobe_rodd_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the Rodd & Gunn database test')
  admin = connect({ max: 1 })
  await admin.unsafe(`create database ${scratch}`)
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `/${scratch}`
  execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
  process.env.DATABASE_URL = url.toString()
  sql = connect({ max: 2 })
})

after(async () => {
  await db().end()
  await sql?.end()
  await admin.unsafe(`drop database if exists ${scratch} with (force)`)
  await admin.end()
})

const fixture = (name: string) => readFileSync(new URL(`./fixtures/rodd-and-gunn-${name}.html`, import.meta.url), 'utf8')

const PAGES: Record<string, string> = {
  '006582-12': fixture('oxford'),
  '006171-19': fixture('chino-regular'),
  '006171-20': fixture('chino-short'),
  '006171-21': fixture('chino-long'),
  '006582': fixture('style'),
}

/** The site: robots.txt and a page per id; any other id answers 410, as a colour no longer sold does. */
function fakeSite(pages: Record<string, string>, seen: string[] = []) {
  return new PoliteClient({
    sleep: async () => {},
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/robots.txt') return new Response('User-Agent: *\nAllow: /\nDisallow: *Product-Variation*\nDisallow: /*?start=')
      const id = /\/(\d{6}(?:-\d{2,3})?)(?:-[A-Z0-9]+)?\.html$/.exec(url.pathname)?.[1]
      if (!id) return new Response('not found', { status: 404 })
      seen.push(`${url.pathname.split('/')[1]}/${id}`)
      const html = pages[id]
      return html ? new Response(html, { headers: { 'content-type': 'text/html' } }) : new Response('gone', { status: 410 })
    }) as typeof fetch,
  })
}

test('Rodd & Gunn is a store read only from links: never walked, no switch, a verified Wellington store', async () => {
  const file = RetailerFileSchema.parse(JSON.parse(readFileSync(new URL('../data/retailers.json', import.meta.url), 'utf8')))
  const seed = file.retailers.find((retailer) => retailer.slug === 'rodd-and-gunn')
  assert.ok(seed)
  await seedRetailers(sql, [seed])
  const store = (await listRetailers(sql)).find((retailer) => retailer.slug === 'rodd-and-gunn')
  assert.ok(store)
  assert.deepEqual([store.platform, store.currency, store.enabled, walkedNightly(store)], ['rodd-and-gunn', 'NZD', false, false])
  assert.equal(store.wellington_store?.address, '46 Willis Street')
  assert.equal((await storeCounts(sql)).some((row) => row.slug === 'rodd-and-gunn'), false, 'no switch on /you/finder')
})

test('a link from any region is read from the NZ page; the same colour twice is one product', async () => {
  const stores = await listRetailers(sql)
  const seen: string[] = []
  const shirt = await addProductFromLink(
    sql,
    fakeSite(PAGES, seen),
    stores,
    'https://www.roddandgunn.com/au/clothing/shirts/oxford-shirt-%C2%B7-powder-blue-xxl/006582-12-XXL.html',
  )
  assert.deepEqual([shirt.title, shirt.retailer], ['Oxford Shirt', 'Rodd & Gunn'])
  assert.deepEqual(seen, ['nz/006582-12'])
  const again = await addProductFromLink(sql, fakeSite(PAGES), stores, 'https://www.roddandgunn.com/nz/clothing/shirts/oxford-shirt/006582-12.html')
  assert.equal(again.productId, shirt.productId)
  const [stored] = await sql<{ url: string; sizes: string[]; in_stock: string[] }[]>`
    select p.url, array_agg(v.option_size order by v.id) as sizes,
           array_agg(v.option_size order by v.id) filter (where v.available) as in_stock
    from products p join product_variants v on v.product_id = p.id where p.id = ${shirt.productId} group by p.id
  `
  assert.deepEqual(stored, {
    url: 'https://www.roddandgunn.com/nz/clothing/shirts/oxford-shirt/006582-12.html',
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
    in_stock: ['XXL', 'XXXL'],
  })
})

test('a link to one leg length reads them all, as one product with its sizes in order', async () => {
  const seen: string[] = []
  const chino = await addProductFromLink(
    sql,
    fakeSite(PAGES, seen),
    await listRetailers(sql),
    'https://www.roddandgunn.com/nz/clothing/pants/thomas-road-chino-pant--%C2%B7-coal-sh-32/006171-20-32.html',
  )
  assert.deepEqual(seen, ['nz/006171-20', 'nz/006171-19', 'nz/006171-21'])
  const [stored] = await sql<{ external_id: string; variants: number; in_stock: string[] }[]>`
    select p.external_id, count(v.id)::int as variants,
           array_agg(v.option_size order by v.id) filter (where v.available) as in_stock
    from products p join product_variants v on v.product_id = p.id where p.id = ${chino.productId} group by p.id
  `
  assert.deepEqual(stored, { external_id: '006171-19', variants: 33, in_stock: ['28', '42', '42', '44', '44', '44'] })
})

test('a link to a style asks which colour; a link that is not a product says so', async () => {
  const stores = await listRetailers(sql)
  await assert.rejects(
    addProductFromLink(sql, fakeSite(PAGES), stores, 'https://www.roddandgunn.com/nz/clothing/shirts/oxford-shirt/006582.html'),
    (error: unknown) => error instanceof ProductLinkError && /^Rodd & Gunn sells it in army, spearmint, .* and .*\. Choose yours/.test(error.message),
  )
  await assert.rejects(addProductFromLink(sql, fakeSite(PAGES), stores, 'https://www.roddandgunn.com/nz/clothing/shirts'), ProductLinkError)
})

test('a saved piece is read again each night, and marked gone when the site stops selling it', async () => {
  const stores = await listRetailers(sql)
  const shirt = await addProductFromLink(sql, fakeSite(PAGES), stores, 'https://www.roddandgunn.com/nz/clothing/shirts/oxford-shirt/006582-12.html')
  await recordAction({ action: 'saved', product_id: shirt.productId, slot_id: null }, sql)

  const seen: string[] = []
  assert.deepEqual(await refreshSaved(sql, fakeSite(PAGES, seen), stores, new Date(Date.now() + 1000)), { checked: 1, removed: 0, failed: 0 })
  assert.deepEqual(seen, ['nz/006582-12'], 'read again by its id')

  const withoutShirt = Object.fromEntries(Object.entries(PAGES).filter(([id]) => id !== '006582-12'))
  assert.deepEqual(await refreshSaved(sql, fakeSite(withoutShirt), stores, new Date(Date.now() + 2000)), { checked: 1, removed: 1, failed: 0 })
  const [state] = await sql<{ removed: boolean; in_stock: number }[]>`
    select removed_at is not null as removed,
           (select count(*)::int from product_variants v where v.product_id = p.id and v.available) as in_stock
    from products p where id = ${shirt.productId}
  `
  assert.deepEqual(state, { removed: true, in_stock: 0 })
})
