import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { connect, type Sql } from '../src/lib/db.ts'
import { db } from '../src/lib/db.ts'
import { getFeed, recordAction, runRates } from '../src/lib/feed.ts'
import { findCandidates, photoKey, slotTargets } from '../src/lib/finder/filter.ts'
import { PoliteClient } from '../src/lib/finder/http.ts'
import { writePage } from '../src/lib/finder/ingest.ts'
import { closeInterrupted, holdFinderLock, liveRun } from '../src/lib/finder/runs.ts'
import { startFinderRun } from '../src/lib/finder/start.ts'
import { addProductFromLink, ProductLinkError, refreshSaved } from '../src/lib/finder/product-link.ts'
import { getFinderSettings, saveFinderSettings, storeCounts } from '../src/lib/finder/settings.ts'
import { listRetailers, RetailerFileSchema, seedRetailers, type RetailerSeed } from '../src/lib/retailers.ts'
import { normaliseProduct, ShopifyProductSchema } from '../src/lib/finder/shopify.ts'
import type { Slot } from '../src/lib/blueprint.ts'

/*
 * The filter, the page writer and the feed actions against a real Postgres,
 * in a scratch database made for this file and dropped after it, never the
 * one DATABASE_URL names.
 */

const scratch = `wardrobe_finder_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the finder database test')
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

let nextId = 1000

/** A Shopify product as the feed would serve it: one variant per size. */
function raw(title: string, sizes: Record<string, { price: string; available?: boolean; compare?: string }>, extra: object = {}) {
  nextId += 10
  const id = nextId
  return ShopifyProductSchema.parse({
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
      compare_at_price: v.compare ?? null,
      available: v.available ?? true,
    })),
    images: [{ src: `https://cdn.shopify.com/s/files/${id}.jpg?v=1` }],
    ...extra,
  })
}

async function retailer(slug: string, currency: string, catalogue: 'menswear' | 'mixed'): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    insert into retailers (slug, name, platform, base_url, country, currency, catalogue)
    values (${slug}, ${slug}, 'shopify', ${`https://${slug}.test`}, 'NZ', ${currency}, ${catalogue})
    returning id::int as id
  `
  return row!.id
}

async function slot(fields: Partial<Slot> & Pick<Slot, 'name' | 'garment_type'>): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    insert into blueprint_slots ${sql({
      position: nextId++,
      name: fields.name,
      why: 'Because.',
      priority: 1,
      garment_type: fields.garment_type,
      colour_family: fields.colour_family ?? null,
      fit: fields.fit ?? null,
      sizes: sql.json(fields.sizes ?? {}),
      budget_min_cents: fields.budget_min_cents ?? null,
      budget_max_cents: fields.budget_max_cents ?? null,
      status: fields.status ?? 'wanted',
      source: 'claude',
    })}
    returning id::int as id
  `
  return row!.id
}

async function slots(): Promise<Slot[]> {
  return sql<Slot[]>`
    select id::int as id, name, garment_type, colour_family, colours, fit, sizes, status,
           budget_min_cents, budget_max_cents
    from blueprint_slots order by id
  `
}

async function productId(title: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`select id::int as id from products where title = ${title}`
  return row!.id
}

test('the filter keeps what fits and drops each thing that does not, for its own reason', async () => {
  const shop = await retailer('shop', 'NZD', 'menswear')
  const end = await retailer('end', 'GBP', 'mixed')
  const tee = await slot({ name: 'Ecru heavyweight cotton crew tee', garment_type: 'tee', colour_family: 'ecru', fit: 'slim', sizes: { labels: ['S'] }, budget_min_cents: 4500, budget_max_cents: 8500 })
  const chino = await slot({ name: 'Putty cotton twill chinos', garment_type: 'trousers', colour_family: 'putty', budget_min_cents: 12000, budget_max_cents: 23000 })
  const belt = await slot({ name: 'Espresso leather belt', garment_type: 'belt', colour_family: 'dark brown', budget_min_cents: 6000, budget_max_cents: 15000 })
  await slot({ name: 'Ecru crew tee', garment_type: 'tee', colour_family: 'ecru', status: 'owned' })

  const local = { base_url: 'https://shop.test', catalogue: 'menswear' as const }
  await writePage(sql, shop, [
    raw('Ecru Crew Tee', { S: { price: '60.00' }, M: { price: '60.00' } }),
    raw('Ecru Heavy Box Tee', { S: { price: '60.00' } }),
    raw('Black Box Tee', { S: { price: '60.00' } }),
    raw('Ecru Tee Only M', { S: { price: '60.00', available: false }, M: { price: '60.00' } }),
    raw('Ecru Premium Tee', { S: { price: '120.00' } }),
    raw('Ecru Marked Down Tee', { S: { price: '30.00', compare: '70.00' } }),
    raw('Ecru Cheap Tee', { S: { price: '30.00' } }),
    raw('Womens Ecru Tee', { S: { price: '60.00' } }),
    raw('Ecru Gone Tee', { S: { price: '60.00' } }),
    raw('Ecru Dismissed Tee', { S: { price: '60.00' } }),
    raw('Plain Tee Photo Black', { S: { price: '60.00' } }),
    raw('Plain Tee Unread', { S: { price: '60.00' } }),
    raw('Putty Chino', { '30': { price: '150.00' }, '32': { price: '150.00' }, '34': { price: '150.00', available: false } }, { product_type: 'Pants' }),
    raw('Espresso Leather Belt', { 'One size': { price: '99.00' } }),
    raw('Espresso Logo Cap', { 'One size': { price: '99.00' } }),
  ].map((product) => normaliseProduct(product, local)))
  await writePage(sql, end, [
    raw('Ecru Pocket T-Shirt', { Small: { price: '30.00' } }, { tags: ['gender:Mens'] }),
    raw('Ecru Heavy T-Shirt', { Small: { price: '45.00' } }, { tags: ['gender:Mens'] }),
  ].map((product) => normaliseProduct(product, { base_url: 'https://end.test', catalogue: 'mixed' })))

  await sql`update products set removed_at = now() where title = 'Ecru Gone Tee'`
  await sql`insert into feed_actions (product_id, action, reason) values (${await productId('Ecru Dismissed Tee')}, 'dismissed', 'fit')`
  const [black] = await sql<{ id: number; src: string }[]>`select id::int as id, images -> 0 ->> 'src' as src from products where title = 'Plain Tee Photo Black'`
  await sql`update products set image_colour_src = ${photoKey(black!.src)}, image_colours = ${['#141414']} where id = ${black!.id}`

  const guideFits = (garment: string) => (garment === 'tee' ? ['slim', 'regular'] : [])
  const targets = slotTargets(await slots(), { tee: 'S' }, () => null, guideFits)
  assert.equal(targets.length, 3, 'the owned slot is not open')
  const { candidates, stats } = await findCandidates(sql, targets, { NZD: 1, GBP: 2.2 })
  const titles = new Map(
    (await sql<{ id: number; title: string }[]>`select id::int as id, title from products`).map((row) => [row.id, row.title]),
  )
  const found = Object.fromEntries(candidates.map((candidate) => [titles.get(candidate.product_id)!, candidate]))

  assert.deepEqual(Object.keys(found).sort(), [
    'Ecru Crew Tee',
    'Ecru Marked Down Tee',
    'Ecru Pocket T-Shirt',
    'Espresso Leather Belt',
    'Plain Tee Unread',
    'Putty Chino',
  ])
  assert.ok(stats.matched > candidates.length, 'the colour rule dropped some')

  assert.deepEqual(found['Ecru Crew Tee']!.slot_ids, [tee])
  assert.deepEqual(found['Ecru Crew Tee']!.sizes, ['S'], 'only his size is listed')
  assert.equal(found['Ecru Crew Tee']!.size_known, true)
  assert.equal(found['Ecru Heavy Box Tee'], undefined, 'a box tee is oversized, and the slim slot and guide do not allow it')
  assert.equal(found['Ecru Marked Down Tee']!.compare_at_cents, 7000, 'a markdown whose full price is in the band')
  assert.equal(found['Ecru Pocket T-Shirt']!.price_cents, 3000, '£30 is NZ$66, inside the band; £45 is NZ$99 and is not')

  assert.deepEqual(found['Putty Chino']!.slot_ids, [chino])
  assert.equal(found['Putty Chino']!.size_known, false, 'no waist on the profile: every size in stock passes, and says so')
  assert.deepEqual(found['Putty Chino']!.sizes.sort(), ['30', '32'])

  assert.deepEqual(found['Espresso Leather Belt']!.slot_ids, [belt], 'a cap is not a belt')
  assert.equal(found['Espresso Leather Belt']!.size_known, true, 'one size needs no size')

  const withWaist = await findCandidates(sql, slotTargets(await slots(), { tee: 'S', waist_cm: 81 }), { NZD: 1, GBP: 2.2 })
  await sql`update retailers set enabled = false where slug = 'end'`
  const withoutEnd = await findCandidates(sql, targets, { NZD: 1, GBP: 2.2 })
  assert.ok(
    !withoutEnd.candidates.some((candidate) => titles.get(candidate.product_id) === 'Ecru Pocket T-Shirt'),
    'a shop switched off is not a candidate',
  )
  assert.equal(withoutEnd.candidates.length, candidates.length - 1)
  await sql`update retailers set enabled = true where slug = 'end'`
  const chinoNow = withWaist.candidates.find((candidate) => titles.get(candidate.product_id) === 'Putty Chino')
  assert.deepEqual(chinoNow?.sizes, ['32'], 'with a waist on the profile, only W32 passes')
  assert.equal(chinoNow?.size_known, true)
})

test('a second ingest of the same page writes observations only for what moved', async () => {
  const shop = await retailer('again', 'NZD', 'menswear')
  const local = { base_url: 'https://again.test', catalogue: 'menswear' as const }
  const product = raw('Navy Overshirt', { S: { price: '200.00' }, M: { price: '200.00' } })
  const first = await writePage(sql, shop, [normaliseProduct(product, local)])
  assert.deepEqual(first, { new: 1, changed: 0, variants: 2, observations: 2 })

  const same = await writePage(sql, shop, [normaliseProduct(product, local)])
  assert.deepEqual(same, { new: 0, changed: 0, variants: 2, observations: 0 })

  const onSale = { ...product, variants: product.variants.map((variant) => ({ ...variant, price: '150.00' })) }
  const sale = await writePage(sql, shop, [normaliseProduct(onSale, local)])
  assert.deepEqual(sale, { new: 0, changed: 0, variants: 2, observations: 2 }, 'a sale is two observations and no new hash')

  const smaller = { ...onSale, variants: onSale.variants.slice(0, 1) }
  const dropped = await writePage(sql, shop, [normaliseProduct(smaller, local)])
  assert.equal(dropped.observations, 1, 'the size the store dropped is now out of stock')
  const [m] = await sql<{ available: boolean }[]>`
    select v.available from product_variants v join products p on p.id = v.product_id
    where p.title = 'Navy Overshirt' and v.option_size = 'M'
  `
  assert.equal(m?.available, false)

  const renamed = { ...smaller, title: 'Navy Wool Overshirt' }
  assert.equal((await writePage(sql, shop, [normaliseProduct(renamed, local)])).changed, 1)
})

test('feed actions move the slot: save makes it a candidate, removing the save undoes it, buying fills it', async () => {
  const shop = await retailer('actions', 'NZD', 'menswear')
  const knit = await slot({ name: 'Pine merino crewneck', garment_type: 'knitwear' })
  await writePage(sql, shop, [
    normaliseProduct(raw('Pine Merino Crew', { S: { price: '200.00' } }), { base_url: 'https://actions.test', catalogue: 'menswear' }),
    normaliseProduct(raw('Bottle Merino Crew', { S: { price: '220.00' } }), { base_url: 'https://actions.test', catalogue: 'menswear' }),
  ])
  const pine = await productId('Pine Merino Crew')
  const bottle = await productId('Bottle Merino Crew')
  const status = async () => (await sql<{ status: string }[]>`select status from blueprint_slots where id = ${knit}`)[0]!.status

  await recordAction({ action: 'saved', product_id: pine, slot_id: knit }, sql)
  await recordAction({ action: 'saved', product_id: bottle, slot_id: knit }, sql)
  assert.equal(await status(), 'candidate')
  await recordAction({ action: 'cleared', product_id: pine, slot_id: knit }, sql)
  assert.equal(await status(), 'candidate', 'another saved find still stands')
  await recordAction({ action: 'dismissed', product_id: bottle, slot_id: knit, reason: 'colour' }, sql)
  assert.equal(await status(), 'wanted', 'nothing saved is left')
  await recordAction({ action: 'bought', product_id: pine, slot_id: knit }, sql)
  assert.equal(await status(), 'owned')

  const [dismissal] = await sql<{ reason: string }[]>`select reason from feed_actions where product_id = ${bottle} and action = 'dismissed'`
  assert.equal(dismissal?.reason, 'colour')
  await assert.rejects(
    recordAction({ action: 'dismissed', product_id: bottle, slot_id: knit, reason: 'ugly' as never }, sql),
    'an unknown reason is refused',
  )
})

test('finder settings round-trip; the shop switches survive a re-seed and come with their numbers', async () => {
  assert.deepEqual(
    await getFinderSettings(sql),
    { max_usd_per_run: 1, max_usd_per_month: null, max_usd_per_search: 0.5, max_usd_statements: 0.5 },
    'the default row',
  )
  const seed: RetailerSeed = {
    slug: 'seeded',
    name: 'Seeded',
    platform: 'shopify',
    base_url: 'https://seeded.test',
    feed_collections: [],
    country: 'NZ',
    currency: 'NZD',
    ships_to_nz: true,
    catalogue: 'menswear',
    enabled: true,
    wellington_store: null,
  }
  await seedRetailers(sql, [seed])
  const others = (await listRetailers(sql)).map((retailer) => retailer.slug).filter((slug) => slug !== 'seeded')

  await saveFinderSettings(
    { max_usd_per_run: 0.5, max_usd_per_month: 8, max_usd_per_search: 0.25, max_usd_statements: 0.2, stores: others },
    sql,
  )
  assert.deepEqual(await getFinderSettings(sql), {
    max_usd_per_run: 0.5,
    max_usd_per_month: 8,
    max_usd_per_search: 0.25,
    max_usd_statements: 0.2,
  })
  const off = async () => (await listRetailers(sql)).find((retailer) => retailer.slug === 'seeded')?.enabled
  assert.equal(await off(), false)
  await seedRetailers(sql, [{ ...seed, name: 'Seeded Again' }])
  assert.equal(await off(), false, 'the file updates the store but never switches it back on')

  const local = { base_url: 'https://seeded.test', catalogue: 'menswear' as const }
  const seeded = (await listRetailers(sql)).find((retailer) => retailer.slug === 'seeded')!
  await writePage(sql, seeded.id, [normaliseProduct(raw('Seeded Tee', { S: { price: '50.00' } }), local)])
  const counts = await storeCounts(sql)
  const row = counts.find((store) => store.slug === 'seeded')
  assert.deepEqual(row, { slug: 'seeded', name: 'Seeded Again', enabled: false, products: 1, shortlisted: 0, finds: 0, usd: 0 })
  assert.equal(counts.length, others.length + 1, 'every shop is listed, on or off')
})

/** A shop that answers robots.txt and one product's .js, with the product changeable between calls. */
function fakeShop(product: () => unknown | null) {
  return new PoliteClient({
    sleep: async () => {},
    fetch: (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /checkout')
      const body = product()
      return body === null ? new Response('Not found', { status: 404 }) : Response.json(body)
    }) as typeof fetch,
  })
}

test('a pasted link is read from its shop, stored, saved without a slot, and kept current each night', async () => {
  await retailer('linked', 'NZD', 'mixed')
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/shopify-product.js.json', import.meta.url), 'utf8'))
  let current: unknown | null = fixture
  const client = () => fakeShop(() => current)
  const stores = await listRetailers(sql)

  await assert.rejects(
    addProductFromLink(sql, client(), stores, 'https://www.asos.com/products/anything'),
    (error: unknown) => error instanceof ProductLinkError && /only read the shops it knows/.test(error.message),
  )

  const added = await addProductFromLink(sql, client(), stores, 'https://linked.test/products/cot-strap-knit-shirt-60321701?variant=1')
  assert.equal(added.title, 'Cot Strap Knit Shirt')
  await recordAction({ action: 'saved', product_id: added.productId, slot_id: null }, sql)
  const [saved] = await sql<{ price_cents: number; slot_id: number | null }[]>`
    select price_cents, slot_id from feed_actions where product_id = ${added.productId}
  `
  assert.deepEqual(saved, { price_cents: 17900, slot_id: null }, 'saved at its lowest price in stock, for no slot')

  // The next night: the walk did not see it (it is not in a collection the walk reads).
  const since = new Date(Date.now() + 1000)
  current = { ...fixture, variants: fixture.variants.map((variant: { price: number }) => ({ ...variant, price: 14900 })) }
  assert.deepEqual(await refreshSaved(sql, client(), await listRetailers(sql), since), { checked: 1, removed: 0, failed: 0 })
  const [price] = await sql<{ price: number }[]>`
    select min(price_cents)::int as price from product_variants where product_id = ${added.productId} and available
  `
  assert.equal(price?.price, 14900, 'a markdown is picked up, so Saved can show the drop')

  current = null
  const later = new Date(Date.now() + 2000)
  assert.deepEqual(await refreshSaved(sql, client(), await listRetailers(sql), later), { checked: 1, removed: 1, failed: 0 })
  const [gone] = await sql<{ removed: boolean; in_stock: number }[]>`
    select removed_at is not null as removed,
           (select count(*)::int from product_variants v where v.product_id = p.id and v.available) as in_stock
    from products p where id = ${added.productId}
  `
  assert.deepEqual(gone, { removed: true, in_stock: 0 }, 'a product the shop no longer has is marked gone')
  const [last] = await sql<{ available: boolean }[]>`
    select o.available from price_observations o join product_variants v on v.id = o.variant_id
    where v.product_id = ${added.productId} order by o.observed_at desc, o.id desc limit 1
  `
  assert.equal(last?.available, false, 'and recorded as out, so Saved can say when it went')
})

test('a currency the run did not record is converted at the conservative rate, never one to one', () => {
  const run = { stats: { fx: { rates: { NZD: 1, GBP: 2.3848 } } } } as unknown as Parameters<typeof runRates>[0]
  const rates = runRates(run)
  assert.deepEqual([rates.NZD, rates.GBP], [1, 2.3848], 'what the run recorded wins')
  assert.ok((rates.AUD ?? 1) > 1, 'a Uniqlo price in AUD is not shown as NZD')
  assert.equal(runRates(null).NZD, 1)
})

/** Uniqlo's site: robots.txt, and a product page per region and product id ("au/E475296-000"), from the saved fixtures. */
function fakeUniqlo(pages: Record<string, string | null>, seen: string[] = []) {
  return new PoliteClient({
    sleep: async () => {},
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      seen.push(url.pathname + url.search)
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /*/*/cart')
      const [, region, id] = /^\/([a-z]{2})\/[a-z]{2}\/products\/([^/]+)\//.exec(url.pathname) ?? []
      const html = pages[`${region}/${id}`]
      return html ? new Response(html, { headers: { 'content-type': 'text/html' } }) : new Response(fixturePage('uniqlo-not-found.html'), { status: 404 })
    }) as typeof fetch,
  })
}

function fixturePage(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

test('a Uniqlo link is read from its page, one product per colour, never walked or switched', async () => {
  const file = RetailerFileSchema.parse(JSON.parse(readFileSync(new URL('../data/retailers.json', import.meta.url), 'utf8')))
  const seeds = file.retailers.filter((store) => store.platform === 'uniqlo')
  assert.deepEqual(
    seeds.map((seed) => [seed.slug, seed.currency, seed.enabled, seed.ships_to_nz]),
    [
      ['uniqlo', 'AUD', false, false],
      ['uniqlo-us', 'USD', false, false],
    ],
  )
  await seedRetailers(sql, seeds)
  const stores = await listRetailers(sql)
  let pages: Record<string, string | null> = {
    'au/E475296-000': fixturePage('uniqlo-sweater.html'),
    'us/E486600-000': fixturePage('uniqlo-us-flannel.html'),
  }
  const seen: string[] = []
  const client = () => fakeUniqlo(pages, seen)

  await assert.rejects(
    addProductFromLink(sql, client(), stores, 'https://www.uniqlo.com/au/en/products/E475296-000/00'),
    (error: unknown) => error instanceof ProductLinkError && /grey, black, natural, green and navy\. Choose yours/.test(error.message),
    'five colours and the link names none',
  )
  await assert.rejects(
    addProductFromLink(sql, client(), stores, 'https://www.uniqlo.com/au/en/men/tops'),
    (error: unknown) => error instanceof ProductLinkError && /not a product page/.test(error.message),
  )

  // A UK link is read from the Australian page for the same product.
  const black = await addProductFromLink(sql, client(), stores, 'https://www.uniqlo.com/uk/en/products/E475296-000/00?colorDisplayCode=09')
  assert.deepEqual([black.title, black.retailer], ['3D KNIT Crew Neck Sweater', 'Uniqlo AU'])
  assert.equal(seen.at(-1), '/au/en/products/E475296-000/00?colorDisplayCode=09')

  // A US link is read from the US page: this flannel shirt (saved from uniqlo.com/us/en on
  // 2026-11-05) is not sold in Australia, where its page is a 404.
  const flannel = await addProductFromLink(sql, client(), stores, 'https://www.uniqlo.com/us/en/products/E486600-000/00?colorDisplayCode=24')
  assert.deepEqual([flannel.title, flannel.retailer], ['Flannel Shirt | Heather', 'Uniqlo US'])
  assert.equal(seen.at(-1), '/us/en/products/E486600-000/00?colorDisplayCode=24')
  const [usStored] = await sql<{ url: string; currency: string; price: number }[]>`
    select p.url, r.currency, min(v.price_cents)::int as price
    from products p join retailers r on r.id = p.retailer_id join product_variants v on v.product_id = p.id
    where p.id = ${flannel.productId} group by p.id, r.currency
  `
  assert.deepEqual(usStored, { url: 'https://www.uniqlo.com/us/en/products/E486600-000/00?colorDisplayCode=24', currency: 'USD', price: 4990 })
  const navy = await addProductFromLink(sql, client(), stores, 'https://www.uniqlo.com/au/en/products/E475296-000/00?colorDisplayCode=69')
  assert.notEqual(navy.productId, black.productId, 'another colour is another product')
  const again = await addProductFromLink(sql, client(), stores, 'https://uniqlo.com/au/en/products/E475296-000/00?colorDisplayCode=09&sizeDisplayCode=004')
  assert.equal(again.productId, black.productId, 'the same colour twice is the same product')

  const [stored] = await sql<{ url: string; handle: string; colours: string[]; image: string }[]>`
    select p.url, p.handle, array_agg(distinct v.option_colour) as colours, p.images -> 0 ->> 'src' as image
    from products p join product_variants v on v.product_id = p.id
    where p.id = ${black.productId} group by p.id
  `
  assert.deepEqual(stored, {
    url: 'https://www.uniqlo.com/au/en/products/E475296-000/00?colorDisplayCode=09',
    handle: 'E475296-000/00/09',
    colours: ['Black'],
    image: 'https://image.uniqlo.com/UQ/ST3/au/imagesgoods/475296/item/augoods_09_475296_3x4.jpg',
  })

  assert.equal((await storeCounts(sql)).some((store) => store.slug.startsWith('uniqlo')), false, 'no switch on /you/finder')

  // Saved, then gone from Uniqlo: the nightly refresh reads the page and marks it removed.
  await recordAction({ action: 'saved', product_id: black.productId, slot_id: null }, sql)
  const state = async () =>
    (await sql<{ seen: Date; removed: boolean }[]>`
      select last_seen_at as seen, removed_at is not null as removed from products where id = ${black.productId}
    `)[0]!
  const before = await state()
  seen.length = 0
  await refreshSaved(sql, client(), await listRetailers(sql), new Date(Date.now() + 1000))
  assert.ok(seen.includes('/au/en/products/E475296-000/00?colorDisplayCode=09'), 'read again from its stored handle')
  const read = await state()
  assert.ok(read.seen > before.seen && !read.removed, 'and kept current')
  pages = {}
  await refreshSaved(sql, client(), await listRetailers(sql), new Date(Date.now() + 2000))
  assert.equal((await state()).removed, true, 'a product Uniqlo no longer has is marked gone')
  await recordAction({ action: 'cleared', product_id: black.productId, slot_id: null }, sql)
})

test('Saved tracks his size: a drop, selling out and coming back are each news on the night they happen', async () => {
  const shop = await retailer('tracked', 'NZD', 'menswear')
  const local = { base_url: 'https://tracked.test', catalogue: 'menswear' as const }
  const knit = await slot({ name: 'Rust lambswool crewneck', garment_type: 'knitwear', sizes: { labels: ['M'] } })
  const product = raw('Rust Lambswool Crew', { S: { price: '249.00' }, M: { price: '249.00' } })
  await writePage(sql, shop, [normaliseProduct(product, local)])
  const id = await productId('Rust Lambswool Crew')
  await recordAction({ action: 'saved', product_id: id, slot_id: knit }, sql)

  /** One night: a run starts, the store is read with these prices, and Today is read back. */
  const night = async (sizes: Record<string, { price: string; available?: boolean }>) => {
    const [run] = await sql<{ id: number }[]>`
      insert into finder_runs (status, finished_at) values ('succeeded', now()) returning id::int as id
    `
    const page = { ...product, variants: product.variants.map((variant) => ({ ...variant, price: sizes[variant.option1!]!.price, available: sizes[variant.option1!]!.available ?? true })) }
    await writePage(sql, shop, [normaliseProduct(page, local)])
    // The feed shows the newest run that recorded a candidate.
    await sql`
      insert into finder_candidates (run_id, product_id, content_hash, slot_ids, size_known, price_cents)
      select ${run!.id}, id, content_hash, ${[knit]}::bigint[], true, 0 from products where id = ${id}
    `
    const feed = await getFeed()
    return feed.saved.find((find) => find.product_id === id)!
  }

  const quiet = await night({ S: { price: '249.00' }, M: { price: '249.00' } })
  assert.equal(quiet.news, null)
  assert.equal(quiet.sizeTracked, true)

  const sale = await night({ S: { price: '249.00' }, M: { price: '199.00' } })
  assert.deepEqual(sale.news && { kind: sale.news.kind, from: 'from' in sale.news ? sale.news.from : null, to: 'to' in sale.news ? sale.news.to : null }, {
    kind: 'cheaper',
    from: 24900,
    to: 19900,
  })

  const smallOnly = await night({ S: { price: '149.00' }, M: { price: '199.00', available: false } })
  assert.equal(smallOnly.news?.kind, 'sold_out', 'S getting cheaper is not his news; M selling out is')

  const back = await night({ S: { price: '149.00' }, M: { price: '199.00' } })
  assert.equal(back.news?.kind, 'back')
  assert.deepEqual(
    back.events.map((event) => event.kind),
    ['back', 'sold_out', 'cheaper'],
    'the whole story since saving, newest first',
  )

  const after = await night({ S: { price: '149.00' }, M: { price: '199.00' } })
  assert.equal(after.news, null, 'the next quiet night has no news')
})

test('one finder run at a time: the lock decides, the live run is the locked one, a dead run is closed', async () => {
  const first = await holdFinderLock(sql)
  assert.ok(first, 'the first run takes the lock')
  assert.equal(await holdFinderLock(sql), null, 'a second run, on another connection, cannot')

  // "Run now" while a run is going: the script itself says so and starts nothing.
  const runsBefore = await sql`select id from finder_runs`
  assert.deepEqual(await startFinderRun(), { ok: false, message: 'A run is already going.' })
  assert.equal((await sql`select id from finder_runs`).length, runsBefore.length, 'no row for a run that did not start')

  const [row] = await sql<{ id: number }[]>`insert into finder_runs default values returning id::int as id`
  assert.deepEqual(
    await liveRun(sql).then((run) => run && { id: run.id, stage: run.stage, judged: run.judged, candidates: run.candidates }),
    { id: row!.id, stage: 'reading', judged: 0, candidates: null },
  )
  await sql`update finder_runs set stats = ${sql.json({ filter: {}, candidates: 12 })} where id = ${row!.id}`
  assert.equal((await liveRun(sql))?.stage, 'judging')
  assert.equal((await liveRun(sql))?.candidates, 12)

  // The process ends without closing its row: the lock goes with it.
  await first.release()
  assert.equal(await liveRun(sql), null, 'a running row without the lock is not a live run')

  const next = await holdFinderLock(sql)
  assert.ok(next, 'the next run can start')
  assert.equal(await closeInterrupted(sql), 1)
  const [closed] = await sql<{ status: string; finished_at: Date | null }[]>`
    select status, finished_at from finder_runs where id = ${row!.id}
  `
  assert.equal(closed?.status, 'failed')
  assert.ok(closed?.finished_at)
  await next.release()
})
