import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { recordAction } from '../src/lib/feed.ts'
import { PoliteClient } from '../src/lib/finder/http.ts'
import { writePage } from '../src/lib/finder/ingest.ts'
import type { ProductForScoring, ScoreOutput, Usage } from '../src/lib/finder/score.ts'
import { getSpend, saveFinderSettings } from '../src/lib/finder/settings.ts'
import { normaliseProduct, ShopifyProductSchema } from '../src/lib/finder/shopify.ts'
import { getProfile, saveSizes } from '../src/lib/profile.ts'
import { listRetailers } from '../src/lib/retailers.ts'
import { getSearch, listSearches, runSearch, startSearch, type RequestRead } from '../src/lib/search.ts'
import { saveGuide } from '../src/lib/style-guide.ts'

import { guideFixture } from './fixtures.ts'

/*
 * A whole search against a real Postgres, in a scratch database made for this
 * file and dropped after it. Claude is never called: the read and the scores
 * are fakes, and the shop answering the re-check is a fake too.
 */

const scratch = `wardrobe_search_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql
let shopId: number

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the search database test')
  admin = connect({ max: 1 })
  await admin.unsafe(`create database ${scratch}`)
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `/${scratch}`
  execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
  process.env.DATABASE_URL = url.toString()
  sql = connect({ max: 2 })

  await getProfile()
  await saveSizes(
    null,
    { tee: 'M', chest_cm: null, waist_cm: null, hips_cm: null, inseam_cm: null, sleeve_cm: null, neck_cm: null, shoe_eu: null, shoe_uk: null, shoe_us: null },
    { tops: null, knits: null, trousers: null, outerwear: null },
  )
  await saveGuide(guideFixture, { model: 'fixture', served_by: 'fixture', input_tokens: 0, output_tokens: 0, generated_at: new Date().toISOString() })
  const [row] = await sql<{ id: number }[]>`
    insert into retailers (slug, name, platform, base_url, country, currency, catalogue)
    values ('shop', 'Shop', 'shopify', 'https://shop.test', 'NZ', 'NZD', 'menswear')
    returning id::int as id
  `
  shopId = row!.id
})

after(async () => {
  await db().end()
  await sql?.end()
  await admin.unsafe(`drop database if exists ${scratch} with (force)`)
  await admin.end()
})

let nextId = 5000

type Sizes = Record<string, { price: number; available?: boolean }>

/** A product as the shop's feed serves it, and as its /products/<handle>.js would. */
function product(title: string, sizes: Sizes) {
  nextId += 10
  const id = nextId
  const handle = `p-${id}`
  const variants = (current: Sizes) =>
    Object.entries(current).map(([size, v], index) => ({ id: id + index + 1, option1: size, title: size, price: v.price, available: v.available ?? true }))
  return {
    id,
    handle,
    feed: ShopifyProductSchema.parse({
      id,
      title,
      handle,
      product_type: '',
      tags: [],
      options: [{ name: 'Size', position: 1, values: Object.keys(sizes) }],
      variants: variants(sizes).map((v) => ({ ...v, price: v.price.toFixed(2) })),
      images: [{ src: `https://cdn.shopify.com/s/files/${id}.jpg?v=1` }],
    }),
    js: (current: Sizes) => ({
      id,
      title,
      handle,
      description: null,
      vendor: null,
      type: '',
      tags: [],
      options: [{ name: 'Size', position: 1, values: Object.keys(current) }],
      images: [`//cdn.shopify.com/s/files/${id}.jpg?v=1`],
      variants: variants(current).map((v) => ({ ...v, price: Math.round(v.price * 100) })),
    }),
  }
}

const wool = product('Navy Wool Overshirt', { S: { price: 250 }, M: { price: 250 }, L: { price: 250 } })
const cord = product('Navy Cord Overshirt', { M: { price: 280 } })
const olive = product('Olive Overshirt', { M: { price: 200 } })
const dear = product('Navy Overshirt Deluxe', { M: { price: 400 } })
const small = product('Navy Twill Overshirt', { S: { price: 220 }, M: { price: 220, available: false } })
const tee = product('Navy Pocket Tee', { M: { price: 60 } })

const read: RequestRead = {
  understood: true,
  garment_type: 'overshirt',
  words: ['overshirt', 'wool'],
  colours: ['navy'],
  min_nzd: null,
  max_nzd: 300,
  fit: null,
  fabrics: [],
  summary: 'A navy overshirt under $300',
  problem: null,
}

const fakeRead = (answer: RequestRead | null, usd = 0.004) => async () => ({ read: answer, usd })

/** Every score costs US$0.02 (10,000 fresh input tokens at Sonnet's $2 a million). */
const usage: Usage = { input: 10_000, output: 0, cacheWrite: 0, cacheRead: 0 }
async function fakeScore(_context: string, item: ProductForScoring) {
  const score = item.title.includes('Wool') ? 88 : 72
  const output: ScoreOutput = {
    slot_id: 0,
    score,
    colour: null,
    colour_verdict: 'navy, one of your neutrals',
    fit_verdict: 'a regular cut, as your guide asks',
    fabric_notes: 'not stated',
    why: `Fills the request; ${item.title}.`,
    alternatives: [],
  }
  return { output, usage, servedBy: 'claude-sonnet-5-5' }
}

/** The shop on the re-check: the wool overshirt is now $230 in M; the cord one is gone. */
function fakeShop(): PoliteClient {
  return new PoliteClient({
    sleep: async () => {},
    fetch: (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /checkout')
      if (url.includes(`/products/${wool.handle}.js`)) {
        return Response.json(wool.js({ S: { price: 230 }, M: { price: 230 }, L: { price: 230, available: false } }))
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch,
  })
}

const noop = () => {}

test('a search reads the request, filters in his size, judges the closest, and re-checks what it shows', async () => {
  const local = { base_url: 'https://shop.test', catalogue: 'menswear' as const }
  await writePage(sql, shopId, [wool, cord, olive, dear, small, tee].map((item) => normaliseProduct(item.feed, local)))

  const started = await startSearch('  a navy   overshirt under $300 ', sql)
  assert.ok(started.ok)
  const busy = await startSearch('a brown belt', sql)
  assert.deepEqual(busy, { ok: false, message: 'Another search is still running. One at a time.' })

  const outcome = await runSearch(started.id, { sql, log: noop, read: fakeRead(read), scoreOne: fakeScore, client: fakeShop() })
  assert.equal(outcome, 'done')

  const offered = await sql<{ title: string; rank: number; score: number; in_stock: boolean }[]>`
    select p.title, r.rank, r.score, r.in_stock from search_results r join products p on p.id = r.product_id
    where r.search_id = ${started.id} order by r.rank
  `
  assert.deepEqual(
    offered.map((row) => row.title),
    ['Navy Wool Overshirt', 'Navy Cord Overshirt'],
    'olive is the wrong colour, the deluxe over $300, the twill not in M, the tee not an overshirt; wool is closer to his words',
  )
  assert.equal(offered[1]!.in_stock, false, 'the cord overshirt has gone from the shop')

  const view = await getSearch(started.id, sql)
  assert.ok(view)
  assert.equal(view.status, 'done')
  assert.equal(view.request, 'a navy overshirt under $300', 'kept as typed, spaces tidied')
  assert.equal(view.summary, 'A navy overshirt under $300')
  assert.equal(view.scored, 2)
  assert.equal(view.closest, false)
  assert.equal(view.results.length, 1)
  const [find] = view.results
  assert.equal(find!.slot_id, null, 'a search result fills no slot')
  assert.equal(find!.price.nzdCents, 23000, 'the price the re-check found, not last night’s')
  assert.deepEqual(find!.sizes, ['M'], 'his size, still in stock')
  assert.equal(find!.size_known, true)
  assert.ok(Math.abs(view.usd - 0.044) < 1e-9, 'the read and two scores')
  assert.equal(view.stats.candidates, 2)
  assert.equal(view.stats.gone, 1)

  // Saving it records the search's price and size, with no slot; it then leaves the page.
  await recordAction({ action: 'saved', product_id: find!.product_id, slot_id: null }, sql)
  const [saved] = await sql<{ price_cents: number; size: string; slot_id: number | null }[]>`
    select price_cents, size, slot_id from feed_actions where product_id = ${find!.product_id}
  `
  assert.deepEqual(saved, { price_cents: 23000, size: 'M', slot_id: null })
  assert.equal((await getSearch(started.id, sql))!.results.length, 0)

  assert.ok(Math.abs((await getSpend(sql)).thisMonth - 0.044) < 1e-9, 'a search counts toward the month')
  const [listed] = await listSearches(5, sql)
  assert.equal(listed!.id, started.id)
  assert.equal(listed!.finds, 1)
})

test('a search stops at its limit, closest to his words first', async () => {
  const retailers = await listRetailers(sql)
  await saveFinderSettings(
    { max_usd_per_run: 1, max_usd_per_month: null, max_usd_per_search: 0.03, max_usd_statements: 0.5, stores: retailers.map((store) => store.slug) },
    sql,
  )
  // A new product that matches, so there are two to judge again.
  await writePage(sql, shopId, [normaliseProduct(product('Navy Linen Overshirt', { M: { price: 190 } }).feed, { base_url: 'https://shop.test', catalogue: 'menswear' })])
  const started = await startSearch('a navy wool overshirt', sql)
  assert.ok(started.ok)
  await runSearch(started.id, { sql, log: noop, read: fakeRead(read, 0.01), scoreOne: fakeScore, client: fakeShop() })
  const view = (await getSearch(started.id, sql))!
  assert.equal(view.status, 'done', view.error ?? '')
  assert.equal(view.max_usd, 0.03)
  assert.equal(view.scored, 1, 'the read left US$0.02, one score')
  assert.equal(view.stats.skipped_for_budget, 1)
  const [judged] = await sql<{ title: string }[]>`
    select p.title from search_results r join products p on p.id = r.product_id
    where r.search_id = ${started.id} and r.scored_at is not null
  `
  assert.equal(view.offered, 2, 'the saved wool overshirt is not judged again')
  assert.equal(judged!.title, 'Navy Linen Overshirt', 'level on his words with the cord one, and newer')
})

test('a request that is not clothing fails with the read’s own words, and costs only the read', async () => {
  const started = await startSearch('a new phone', sql)
  assert.ok(started.ok)
  const outcome = await runSearch(started.id, {
    sql,
    log: noop,
    read: fakeRead({ ...read, understood: false, garment_type: null, problem: 'A phone is not clothing. Name a piece of menswear.' }),
    scoreOne: fakeScore,
    client: fakeShop(),
  })
  assert.equal(outcome, 'failed')
  const view = (await getSearch(started.id, sql))!
  assert.equal(view.status, 'failed')
  assert.equal(view.error, 'A phone is not clothing. Name a piece of menswear.')
  assert.equal(view.usd, 0.004)
})

test('searching is refused when its limit is nothing', async () => {
  const retailers = await listRetailers(sql)
  await saveFinderSettings(
    { max_usd_per_run: 1, max_usd_per_month: null, max_usd_per_search: 0, max_usd_statements: 0.5, stores: retailers.map((store) => store.slug) },
    sql,
  )
  const refused = await startSearch('a navy overshirt', sql)
  assert.equal(refused.ok, false)
})
