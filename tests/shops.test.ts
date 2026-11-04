import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { CARDS_PER_SLOT, getFeed, recordAction, shownOnToday } from '../src/lib/feed.ts'
import { writePage } from '../src/lib/finder/ingest.ts'
import { normaliseProduct, ShopifyProductSchema } from '../src/lib/finder/shopify.ts'
import { parseShopQuery, shopQueryString, type ShopQuery } from '../src/lib/shop-query.ts'
import { defaultSlot, searchPatterns, searchShops } from '../src/lib/shops.ts'

/*
 * The Shops page's search: the query read from the URL, and the catalogue
 * search against a real Postgres, in a scratch database made for this file
 * and dropped after it.
 */

test('a query from the URL: junk falls back to the defaults, and the defaults stay out of the URL', () => {
  assert.deepEqual(parseShopQuery({}), { q: '', kind: null, shop: null, size: 'mine', sort: 'closest', page: 1 })
  assert.deepEqual(
    parseShopQuery({ q: '  navy  ', kind: 'cardigan', shop: 'Not A Slug!', size: 'huge', sort: 'random', page: '-2' }),
    { q: 'navy', kind: null, shop: null, size: 'mine', sort: 'closest', page: 1 },
  )
  const query = parseShopQuery({ q: 'navy overshirt', kind: ['overshirt', 'tee'], shop: 'barkers', size: 'any', sort: 'price', page: '3' })
  assert.deepEqual(query, { q: 'navy overshirt', kind: 'overshirt', shop: 'barkers', size: 'any', sort: 'price', page: 3 })
  assert.equal(shopQueryString(query), '?q=navy+overshirt&kind=overshirt&shop=barkers&size=any&sort=price&page=3')
  assert.equal(shopQueryString(query, 1), '?q=navy+overshirt&kind=overshirt&shop=barkers&size=any&sort=price', 'page one is the default')
  assert.equal(shopQueryString(parseShopQuery({})), '')
})

test('search words match anywhere, each one, with % and _ taken literally', () => {
  assert.deepEqual(searchPatterns(' navy   overshirt '), ['%navy%', '%overshirt%'])
  assert.deepEqual(searchPatterns('100% wool_blend'), ['%100\\%%', '%wool\\_blend%'])
  assert.deepEqual(searchPatterns(''), [])
})

test('a save goes to the slot Claude matched while it is open, else the first open slot for the garment', () => {
  const open = [
    { id: 1, garment_type: 'tee' as const },
    { id: 2, garment_type: 'knitwear' as const },
    { id: 3, garment_type: 'knitwear' as const },
  ]
  assert.equal(defaultSlot({ judged: { score: 50, slot_id: 3, why: null }, garment_type: 'knitwear' }, open), 3)
  assert.equal(defaultSlot({ judged: { score: 50, slot_id: 9, why: null }, garment_type: 'knitwear' }, open), 2, 'slot 9 is not open')
  assert.equal(defaultSlot({ judged: null, garment_type: 'tee' }, open), 1)
  assert.equal(defaultSlot({ judged: null, garment_type: 'boots' }, open), null)
  assert.equal(defaultSlot({ judged: null, garment_type: null }, open), null)
})

const scratch = `wardrobe_shops_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the shops database test')
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

let nextId = 5000

function product(
  slug: string,
  title: string,
  sizes: Record<string, { price: string; available?: boolean }>,
  extra: object = {},
) {
  nextId += 10
  const id = nextId
  const raw = ShopifyProductSchema.parse({
    id,
    title,
    handle: `p-${id}`,
    product_type: '',
    tags: [],
    options: [{ name: 'Size', position: 1, values: Object.keys(sizes) }],
    variants: Object.entries(sizes).map(([size, v], index) => ({
      id: id + index + 1,
      option1: size,
      price: v.price,
      compare_at_price: null,
      available: v.available ?? true,
    })),
    images: [{ src: `https://cdn.shopify.com/s/files/${id}.jpg?v=1` }],
    ...extra,
  })
  return normaliseProduct(raw, { base_url: `https://${slug}.test`, catalogue: 'menswear' })
}

async function retailer(slug: string, enabled = true): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    insert into retailers (slug, name, platform, base_url, country, currency, catalogue, enabled)
    values (${slug}, ${slug}, 'shopify', ${`https://${slug}.test`}, 'NZ', 'NZD', 'menswear', ${enabled})
    returning id::int as id
  `
  return row!.id
}

async function slot(name: string, garment: string, status = 'wanted'): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    insert into blueprint_slots (position, name, why, priority, garment_type, status, source)
    values (${nextId++}, ${name}, 'Because.', 1, ${garment}, ${status}, 'claude')
    returning id::int as id
  `
  return row!.id
}

async function productId(title: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`select id::int as id from products where title = ${title}`
  return row!.id
}

const query = (fields: Partial<ShopQuery> = {}): ShopQuery => ({ ...parseShopQuery({}), ...fields })
const titles = (page: { pieces: { title: string }[] }) => page.pieces.map((piece) => piece.title)

test('the catalogue: in stock at a shop he has on, in his size, Claude’s verdict first, searchable', async () => {
  await sql`insert into profile (id, sizes) values (1, ${sql.json({ tee: 'S' })}) on conflict (id) do update set sizes = excluded.sizes`
  const shop = await retailer('shop')
  const off = await retailer('off', false)
  const knit = await slot('Pine merino crewneck', 'knitwear')
  await slot('Navy overshirt', 'overshirt')
  await slot('Ecru tee', 'tee', 'owned')

  await writePage(sql, shop, [
    product('shop', 'Pine Merino Knit Crew', { S: { price: '200.00' }, M: { price: '200.00' } }),
    product('shop', 'Bottle Merino Knit Crew', { S: { price: '220.00', available: false }, M: { price: '220.00' } }),
    product('shop', 'Navy Cotton Overshirt', { S: { price: '150.00' } }),
    product('shop', 'Rust Merino Knit Crew', { S: { price: '90.00' } }),
    product('shop', 'Sold Out Knit Crew', { S: { price: '90.00', available: false } }),
    product('shop', 'Gone Knit Crew', { S: { price: '90.00' } }),
    product('shop', 'Wool Scarf 100% Lambswool', { 'One size': { price: '80.00' } }),
    product('shop', 'Field Overshirt', {}, {
      options: [
        { name: 'Colour', position: 1, values: ['Navy'] },
        { name: 'Size', position: 2, values: ['S'] },
      ],
      variants: [{ id: 990001, option1: 'Navy', option2: 'S', price: '180.00', compare_at_price: null, available: true }],
    }),
  ])
  await writePage(sql, off, [product('off', 'Off Shop Knit Crew', { S: { price: '90.00' } })])
  await sql`update products set removed_at = now() where title = 'Gone Knit Crew'`

  const pine = await productId('Pine Merino Knit Crew')
  const bottle = await productId('Bottle Merino Knit Crew')
  const rust = await productId('Rust Merino Knit Crew')
  const navy = await productId('Navy Cotton Overshirt')
  const [run] = await sql<{ id: number }[]>`insert into finder_runs (status, finished_at) values ('succeeded', now()) returning id::int as id`
  await sql`
    insert into finder_candidates (run_id, product_id, content_hash, slot_ids, sizes, size_known, price_cents)
    select ${run!.id}, id, content_hash, ${[knit]}, '{S}', true, 20000 from products where id in (${pine}, ${rust}, ${navy})
  `
  await sql`
    insert into product_scores (product_id, content_hash, slot_id, score, why, model)
    select id, content_hash, null, 30, 'Not one of yours.', 'test' from products where id = ${navy}
  `
  await sql`
    insert into product_scores (product_id, content_hash, slot_id, score, why, model)
    select id, content_hash, ${knit}, case id when ${pine} then 84 else 45 end,
           case id when ${pine} then 'Your pine, in fine merino.' else 'Too bright.' end, 'test'
    from products where id in (${pine}, ${bottle})
  `

  const mine = await searchShops(query(), sql)
  assert.equal(mine.read, true)
  assert.deepEqual(
    titles(mine).slice(0, 3),
    ['Pine Merino Knit Crew', 'Rust Merino Knit Crew', 'Navy Cotton Overshirt'],
    'matched to an open slot first, then shortlisted and waiting, then judged a fit for no slot',
  )
  assert.ok(!titles(mine).includes('Bottle Merino Knit Crew'), 'only an M is left, and he is an S')
  for (const gone of ['Sold Out Knit Crew', 'Gone Knit Crew', 'Off Shop Knit Crew']) {
    assert.ok(!titles(mine).includes(gone), `${gone} is not listed`)
  }
  assert.ok(titles(mine).includes('Wool Scarf 100% Lambswool'), 'his size for a scarf is not a thing; every size passes')

  const [first, second] = mine.pieces
  assert.equal(first!.on_today, true, 'clears the bar for an open slot it was shortlisted for')
  assert.deepEqual(first!.judged, { score: 84, slot_id: knit, why: 'Your pine, in fine merino.' })
  assert.deepEqual(first!.sizes, ['S'], 'narrowed to his size')
  assert.equal(first!.size_known, true)
  assert.equal(first!.price.nzdCents, 20000)
  assert.equal(second!.judged, null)
  assert.equal(second!.shortlisted, true)

  const every = await searchShops(query({ size: 'any', q: 'merino crew' }), sql)
  assert.deepEqual(titles(every), ['Pine Merino Knit Crew', 'Bottle Merino Knit Crew', 'Rust Merino Knit Crew'])
  const bottleRow = every.pieces[1]!
  assert.equal(bottleRow.on_today, false, 'judged below the bar, and never shortlisted')
  assert.deepEqual(bottleRow.sizes, ['M'])
  assert.equal(bottleRow.size_known, false)
  assert.deepEqual(every.pieces[0]!.sizes, ['S', 'M'], 'every size in stock, in the store’s order')

  assert.deepEqual(titles(await searchShops(query({ q: '100%' }), sql)), ['Wool Scarf 100% Lambswool'], '% is a character, not a wildcard')
  assert.deepEqual(
    titles(await searchShops(query({ kind: 'overshirt' }), sql)).sort(),
    ['Field Overshirt', 'Navy Cotton Overshirt'],
  )
  assert.deepEqual(
    titles(await searchShops(query({ q: 'navy overshirt' }), sql)).sort(),
    ['Field Overshirt', 'Navy Cotton Overshirt'],
    'a colour named only on the variant is searched too',
  )
  assert.deepEqual(titles(await searchShops(query({ shop: 'off' }), sql)), [], 'a shop he switched off lists nothing')

  const cheapest = await searchShops(query({ sort: 'price' }), sql)
  assert.deepEqual(
    cheapest.pieces.map((piece) => piece.price.nzdCents),
    [...cheapest.pieces.map((piece) => piece.price.nzdCents)].sort((a, b) => a - b),
  )

  await recordAction({ action: 'saved', product_id: bottle, slot_id: knit }, sql)
  const saved = (await searchShops(query({ size: 'any', q: 'bottle' }), sql)).pieces[0]!
  assert.deepEqual(saved.action, { kind: 'saved', slot_id: knit, reason: null })
  await recordAction({ action: 'dismissed', product_id: pine, slot_id: knit, reason: 'colour' }, sql)
  const dismissed = (await searchShops(query({ q: 'pine' }), sql)).pieces[0]!
  assert.deepEqual(dismissed.action, { kind: 'dismissed', slot_id: knit, reason: 'colour' })
  assert.equal(dismissed.on_today, false, 'dismissed is off Today')

  const paged = await searchShops(query({ size: 'any', page: 2 }), sql)
  assert.equal(paged.total, 6)
  assert.equal(paged.pages, 1)
  assert.deepEqual(paged.pieces, [], 'a page past the end is empty, and still knows the count')
})

test('what Shops marks as on Today is what Today shows: the best of each open slot, nothing acted on', async () => {
  const shop = await retailer('today')
  const coat = await slot('Camel overcoat', 'coat')
  const owned = await slot('Charcoal overcoat', 'coat', 'owned')
  const coats = Array.from({ length: CARDS_PER_SLOT + 2 }, (_, index) => `Camel Wool Coat ${index + 1}`)
  await writePage(sql, shop, [
    ...coats.map((title) => product('today', title, { S: { price: '400.00' } })),
    product('today', 'Charcoal Wool Coat', { S: { price: '400.00' } }),
  ])
  const ids = await sql<{ id: number; title: string }[]>`
    select id::int as id, title from products where retailer_id = ${shop} order by id
  `
  const [run] = await sql<{ id: number }[]>`insert into finder_runs (status, finished_at) values ('succeeded', now()) returning id::int as id`
  for (const [index, row] of ids.entries()) {
    const target = row.title.startsWith('Charcoal') ? owned : coat
    await sql`
      insert into finder_candidates (run_id, product_id, content_hash, slot_ids, sizes, size_known, price_cents)
      select ${run!.id}, id, content_hash, ${[target]}, '{S}', true, 40000 from products where id = ${row.id}
    `
    await sql`
      insert into product_scores (product_id, content_hash, slot_id, score, why, model)
      select id, content_hash, ${target}, ${target === owned ? 99 : 95 - index}, 'Camel.', 'test' from products where id = ${row.id}
    `
  }
  // The best one is dismissed, so the next eight show.
  await recordAction({ action: 'dismissed', product_id: ids[0]!.id, slot_id: coat, reason: 'fit' }, sql)

  const shown = await shownOnToday(sql, run!.id)
  const feed = await getFeed()
  assert.deepEqual(
    [...shown].sort((a, b) => a - b),
    feed.groups.flatMap((group) => group.cards.map((card) => card.product_id)).sort((a, b) => a - b),
  )
  assert.equal(shown.size, CARDS_PER_SLOT)
  assert.ok(!shown.has(ids[0]!.id), 'dismissed')
  assert.ok(!shown.has(ids.at(-2)!.id), 'the slot’s ninth best is behind the eight')
  assert.ok(!shown.has(ids.at(-1)!.id), 'the slot is owned')

  const listed = await searchShops(query({ q: 'coat' }), sql)
  const ninth = listed.pieces.find((piece) => piece.product_id === ids.at(-2)!.id)!
  assert.equal(ninth.on_today, false)
  assert.equal(ninth.shortlisted, true)
  assert.equal(listed.pieces.filter((piece) => piece.on_today).length, CARDS_PER_SLOT)
  assert.equal(listed.pieces.at(-1)!.title, 'Charcoal Wool Coat', 'a match for an owned slot comes after those for open ones')
})
