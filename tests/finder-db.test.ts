import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'

import { connect, type Sql } from '../src/lib/db.ts'
import { recordAction } from '../src/lib/feed.ts'
import { findCandidates, photoKey, slotTargets } from '../src/lib/finder/filter.ts'
import { writePage } from '../src/lib/finder/ingest.ts'
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
  const belt = await slot({ name: 'Espresso leather belt', garment_type: 'accessory', colour_family: 'dark brown', budget_min_cents: 6000, budget_max_cents: 15000 })
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
