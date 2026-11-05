import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'

import { MODELS } from '../src/lib/claude.ts'
import { connect, db, type Sql } from '../src/lib/db.ts'
import { recordAction } from '../src/lib/feed.ts'
import { writePage } from '../src/lib/finder/ingest.ts'
import { normaliseProduct, ShopifyProductSchema } from '../src/lib/finder/shopify.ts'
import {
  findStatementCandidates,
  judgeStatements,
  recordStatementCandidates,
  unjudgedStatements,
  type StatementOutput,
} from '../src/lib/finder/statements.ts'
import { listPieces } from '../src/lib/pieces.ts'
import { getStatements } from '../src/lib/statements.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

/*
 * Statement pieces against a real Postgres: the rules over what was read,
 * the judge's verdicts kept once per version, the shelf, and a save from it,
 * in a scratch database made for this file and dropped after it.
 */

const scratch = `wardrobe_statements_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the statements database test')
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

let nextId = 7000

function product(title: string, sizes: Record<string, string>, extra: object = {}) {
  nextId += 10
  const id = nextId
  const raw = ShopifyProductSchema.parse({
    id,
    title,
    handle: `p-${id}`,
    product_type: '',
    tags: [],
    options: [{ name: 'Size', position: 1, values: Object.keys(sizes) }],
    variants: Object.entries(sizes).map(([size, price], index) => ({
      id: id + index + 1,
      option1: size,
      price,
      compare_at_price: null,
      available: true,
    })),
    images: [{ src: `https://cdn.shopify.com/s/files/${id}.jpg?v=1` }],
    ...extra,
  })
  return normaliseProduct(raw, { base_url: 'https://shop.test', catalogue: 'menswear' })
}

async function productId(title: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`select id::int as id from products where title = ${title}`
  return row!.id
}

/** Oxblood and pine from the fixture, and a rust. */
const guide = {
  ...guideFixture,
  palette: { ...guideFixture.palette, best: [...guideFixture.palette.best, { hex: '#a0522d', name: 'rust', use: 'overshirts' }] },
}

const verdict = (fields: Partial<StatementOutput>): StatementOutput => ({
  qualities: ['colour'],
  score: 80,
  colour: null,
  why: 'It leads.',
  wears_with: [],
  ...fields,
})

test('the rules pick from everything read, the judge keeps one verdict a version, and the shelf shows the best', async () => {
  const [shop] = await sql<{ id: number }[]>`
    insert into retailers (slug, name, platform, base_url, country, currency, catalogue)
    values ('shop', 'Shop', 'shopify', 'https://shop.test', 'NZ', 'NZD', 'menswear')
    returning id::int as id
  `
  await writePage(sql, shop!.id, [
    product('Rust Corduroy Overshirt', { S: '240.00', M: '240.00' }),
    product('Pine Cuban Collar Shirt', { S: '150.00' }),
    product('Mohair Cardigan - Ecru', { S: '260.00' }),
    product('Navy Oxford Shirt', { S: '120.00' }),
    product('Brick Merino Crew', { M: '200.00' }),
    product('Rust Suede Jacket', { S: '1200.00' }),
    product('Oxblood Velvet Blazer', { S: '600.00' }),
  ])
  const overshirt = await productId('Rust Corduroy Overshirt')
  const cuban = await productId('Pine Cuban Collar Shirt')
  const mohair = await productId('Mohair Cardigan - Ecru')
  const blazer = await productId('Oxblood Velvet Blazer')
  // He dismissed the blazer before: it is never offered again.
  await recordAction({ action: 'dismissed', product_id: blazer, slot_id: null, reason: 'fit' }, sql)

  const [chinos] = await sql<{ id: number }[]>`
    insert into wardrobe_pieces (name, garment_type, colour_name, source) values ('Ink navy chinos', 'trousers', 'ink navy', 'typed')
    returning id::int as id
  `
  const [old] = await sql<{ id: number }[]>`
    insert into wardrobe_pieces (name, garment_type, source, set_aside_at) values ('Old boots', 'boots', 'typed', now())
    returning id::int as id
  `

  const { candidates, stats } = await findStatementCandidates(sql, {
    sizes: { tee: 'S' },
    budget: { outerwear: 800 },
    slots: [],
    guide,
    rates: { NZD: 1 },
  })
  assert.deepEqual(
    candidates.map((candidate) => candidate.product_id),
    [overshirt, cuban, mohair],
    'two signals first; navy is quiet, the crew is not in his size, the jacket is over his outerwear budget, the blazer dismissed',
  )
  assert.deepEqual(candidates[0]!.signals, ['colour', 'texture'])
  assert.deepEqual(candidates[0]!.sizes, ['S'], 'narrowed to his size')
  assert.equal(candidates[0]!.price_cents, 24000)
  assert.deepEqual(stats.by_signal, { colour: 2, texture: 2, cut: 1 })
  assert.equal(stats.read, 4, 'the three and the navy oxford: in his size and budget, not dismissed')

  const [run] = await sql<{ id: number }[]>`insert into finder_runs (status) values ('running') returning id::int as id`
  await recordStatementCandidates(sql, run!.id, candidates)
  const products = await unjudgedStatements(sql, candidates)
  assert.equal(products.length, 3)

  const pieces = await listPieces(sql)
  const stats1 = await judgeStatements(sql, run!.id, { profile: profileFixture, guide, pieces, dismissals: [] }, products, {
    maxUsd: 1,
    concurrency: 1,
    log: () => {},
    judgeOne: async (_context, item, pieceIds) => {
      assert.ok(pieceIds.has(chinos!.id) && !pieceIds.has(old!.id), 'a piece set aside is not offered')
      const output =
        item.product_id === overshirt
          ? verdict({ qualities: ['colour', 'texture'], score: 91, colour: null, wears_with: [chinos!.id, old!.id] })
          : item.product_id === cuban
            ? verdict({ qualities: ['cut'], score: 74 })
            : verdict({ qualities: ['texture'], score: 55 })
      return { output, usage: { input: 1000, output: 100, cacheWrite: 0, cacheRead: 0 }, servedBy: MODELS.scoring }
    },
  })
  assert.equal(stats1.scored, 3)
  assert.deepEqual(await unjudgedStatements(sql, candidates), [], 'judged once a version')
  await sql`update finder_runs set status = 'succeeded', finished_at = now() where id = ${run!.id}`
  // The old boots are set aside after the verdict: the shelf drops them.
  await sql`update wardrobe_pieces set set_aside_at = now() where id = ${old!.id}`

  const shelf = await getStatements({}, sql)
  assert.equal(shelf.run?.id, run!.id)
  assert.deepEqual(shelf.finds.map((find) => find.product_id), [overshirt, cuban], 'over the bar, best first')
  assert.equal(shelf.total, 2)
  assert.deepEqual(shelf.byQuality, { colour: 1, texture: 1, cut: 1 })
  assert.equal(shelf.waiting, 0)
  const [first] = shelf.finds
  assert.deepEqual(first!.wears_with, [{ id: chinos!.id, name: 'Ink navy chinos', colour_hex: null, image: null, photo: null }])
  assert.equal(first!.slot_id, null)
  assert.deepEqual(first!.qualities, ['colour', 'texture'])
  assert.equal(first!.price.nzdCents, 24000)

  assert.deepEqual(
    (await getStatements({ quality: 'cut' }, sql)).finds.map((find) => find.product_id),
    [cuban],
    'the filter keeps the counts of all',
  )

  // Saved from the shelf: at the price and size the run found in his size, and off the shelf.
  await recordAction({ action: 'saved', product_id: overshirt, slot_id: null }, sql)
  const [saved] = await sql<{ price_cents: number; size: string }[]>`
    select price_cents, size from feed_actions where product_id = ${overshirt} order by id desc limit 1
  `
  assert.deepEqual(saved, { price_cents: 24000, size: 'S' })
  assert.deepEqual((await getStatements({}, sql)).finds.map((find) => find.product_id), [cuban])
})
