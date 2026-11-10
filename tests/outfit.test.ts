import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { recordAction } from '../src/lib/feed.ts'
import { writePage } from '../src/lib/finder/ingest.ts'
import { normaliseProduct, ShopifyProductSchema } from '../src/lib/finder/shopify.ts'
import { readLooks } from '../src/lib/looks.ts'
import {
  buildOutfitMessages,
  coversOutfit,
  getOutfit,
  listOutfits,
  pickForWant,
  POOL_CLOSEST,
  POOL_LIKED,
  runOutfit,
  startOutfit,
  tidyOutfit,
  wantTarget,
  type ComposeInput,
  type Composed,
  type OutfitDraft,
  type Plan,
  type PoolItem,
  type Want,
} from '../src/lib/outfit.ts'
import { createPiece } from '../src/lib/pieces.ts'
import { getProfile, saveSizes } from '../src/lib/profile.ts'
import { saveGuide } from '../src/lib/style-guide.ts'
import { startAskedOutfitTryOn } from '../src/lib/try-on.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

/* An outfit from scratch: the rules that need nothing, then whole asks against a real Postgres with Claude faked. */

const pieces = [
  { id: 1, garment_type: 'shirt', set_aside_at: null, worn_for: 'everyday' },
  { id: 2, garment_type: 'trousers', set_aside_at: null, worn_for: 'everyday' },
  { id: 3, garment_type: 'boots', set_aside_at: null, worn_for: 'everyday' },
  { id: 4, garment_type: 'knitwear', set_aside_at: new Date(), worn_for: 'everyday' },
  { id: 5, garment_type: 'tank', set_aside_at: null, worn_for: 'gym' },
] as const

const pool = [
  { product_id: 101, garment_type: 'tailoring' },
  { product_id: 102, garment_type: 'shirt' },
  { product_id: 103, garment_type: 'trousers' },
  { product_id: 104, garment_type: 'shoes' },
] as const

const draft = (over: Partial<OutfitDraft>): OutfitDraft => ({
  title: ' Ink suit, rust tie ',
  occasion: 'evening',
  weather: 'a cool evening',
  piece_ids: [],
  shop_items: [],
  ideas: [],
  why: 'Navy and ecru.',
  styling: null,
  ...over,
})

const shop = (...ids: number[]) => ids.map((id) => ({ id, why: ' the one ' }))

describe('what an outfit must be', () => {
  test('from both: his pieces and the shops’ in layer order, his own first, unknowns and repeats dropped', () => {
    const tidy = tidyOutfit(draft({ piece_ids: [3, 2, 2, 99, 4], shop_items: shop(102, 101, 101, 555) }), 'both', [...pieces], [...pool])
    assert.ok(tidy)
    assert.equal(tidy.title, 'Ink suit, rust tie')
    assert.deepEqual(
      tidy.items.map((item) => item.piece_id ?? `f${item.product_id}`),
      ['f101', 'f102', 2, 3],
      'tailoring, the shirt, his trousers, his boots; the set-aside knit, piece 99 and product 555 are gone',
    )
    assert.equal(tidy.items[0]!.why, 'the one')
  })

  test('from the shops alone his pieces are left out, and what is left must still be whole', () => {
    assert.equal(tidyOutfit(draft({ piece_ids: [2, 3], shop_items: shop(101, 102) }), 'shops', [...pieces], [...pool]), null)
    const whole = tidyOutfit(draft({ piece_ids: [1], shop_items: shop(102, 103, 104) }), 'shops', [...pieces], [...pool])
    assert.deepEqual(whole?.items.map((item) => item.product_id), [102, 103, 104])
  })

  test('from his wardrobe alone a product is left out; gym kit stays out of an everyday outfit', () => {
    const tidy = tidyOutfit(draft({ piece_ids: [1, 2, 3, 5], shop_items: shop(101) }), 'wardrobe', [...pieces], [...pool])
    assert.deepEqual(tidy?.items.map((item) => item.piece_id), [1, 2, 3])
  })

  test('from anything: only the garments described, whole by their garments, a bad hex dropped', () => {
    const idea = (garment_type: 'shirt' | 'trousers' | 'shoes', colour_hex: string) => ({
      garment_type, name: ` Ecru ${garment_type} `, colour_name: 'ecru', colour_hex, fabric: null, fit: ' regular ', why: 'the base', search: `ecru ${garment_type}`,
    })
    const ideas = [idea('shoes', '#33221A'), idea('shirt', 'cream'), idea('trousers', '#33221a')]
    const tidy = tidyOutfit(draft({ piece_ids: [1], shop_items: shop(101), ideas }), 'anywhere', [...pieces], [...pool])
    assert.deepEqual(tidy?.items.map((item) => item.idea?.name), ['Ecru shirt', 'Ecru trousers', 'Ecru shoes'], 'in layer order; his piece and the product are left out')
    assert.deepEqual(tidy?.items.map((item) => item.idea?.colour_hex), [null, '#33221a', '#33221a'])
    assert.equal(tidy?.items[0]!.idea?.fit, 'regular')
    assert.equal(tidyOutfit(draft({ piece_ids: [1, 2, 3], ideas: [] }), 'anywhere', [...pieces], [...pool]), null, 'nothing described is no outfit')
    assert.deepEqual(
      tidyOutfit(draft({ piece_ids: [1, 2, 3], ideas }), 'wardrobe', [...pieces], [...pool])?.items.map((item) => item.piece_id),
      [1, 2, 3],
      'a described garment is left out of any other source',
    )
  })

  test('two pairs of trousers are not an outfit', () => {
    assert.equal(tidyOutfit(draft({ piece_ids: [1, 2, 3], shop_items: shop(103) }), 'both', [...pieces], [...pool]), null)
  })

  test('the pool dresses him alone only with a top, trousers and shoes', () => {
    assert.equal(coversOutfit([...pool]), true)
    assert.equal(coversOutfit(pool.filter((item) => item.garment_type !== 'shoes')), false)
  })
})

describe('what the shops are asked for', () => {
  const want: Want = { garment_type: 'tailoring', words: ['blazer', 'wool'], colours: ['navy'], max_nzd: null, role: 'the jacket' }

  test('a want is the filter’s target: its place in the plan, his size, his ceiling unless the brief gave a price', () => {
    const target = wantTarget(want, 2, { tee: 'M' }, () => ['regular'], { tailoring: 60000 })
    assert.equal(target.slot_id, 3)
    assert.equal(target.garment_type, 'tailoring')
    assert.equal(target.max_cents, 60000)
    assert.ok(target.families?.includes('navy'))
    assert.deepEqual(target.fits, ['regular'])
    assert.equal(wantTarget({ ...want, max_nzd: 400 }, 0, {}, () => [], { tailoring: 60000 }).max_cents, 40000)
    assert.equal(wantTarget(want, 0, {}, () => [], {}).max_cents, null)
  })

  test('Opus sees the closest of each, then the best of the rest he saved or Claude rated well', () => {
    const ranked = Array.from({ length: 30 }, (_, index) => ({ product_id: index + 1 }))
    const liked = new Map([
      [3, { rated: 95, saved: true }],
      [15, { rated: 72, saved: false }],
      [16, { rated: 60, saved: false }],
      [20, { rated: null, saved: true }],
      [22, { rated: 90, saved: false }],
      [25, { rated: 80, saved: false }],
      [28, { rated: 75, saved: false }],
    ])
    const picked = pickForWant(ranked, liked).map((product) => product.product_id)
    assert.deepEqual(picked.slice(0, POOL_CLOSEST), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(picked.slice(POOL_CLOSEST), [20, 22, 25, 28], 'saved first, then by score; 60 is not well rated, 72 is cut by the limit')
    assert.equal(picked.length, POOL_CLOSEST + POOL_LIKED)
  })

  test('the ask to Opus carries only what the outfit may use', () => {
    const item: PoolItem = {
      product_id: 101, want: 0, garment_type: 'tailoring', title: 'Navy Wool Blazer', vendor: 'Label', retailer: 'Shop', colours: ['Navy'],
      about: 'Half canvassed.', price_cents: 45000, compare_at_cents: null, nzd_cents: 45000, sizes: ['M'], size_known: true, rated: 84, saved: false,
    }
    const input: ComposeInput = {
      brief: 'a wedding on Saturday', source: 'shops', profile: profileFixture, guide: guideFixture, pieces: [],
      history: { worn: new Map(), offered: new Map() }, pool: [item], wants: [want], now: new Date('2026-11-10T00:00:00Z'),
    }
    const content = buildOutfitMessages(input)[0]!.content as string
    const body = JSON.parse(content.slice(0, content.lastIndexOf('\n\n')))
    assert.equal(body.made_from, 'the shops alone')
    assert.equal(body.his_pieces, undefined)
    assert.deepEqual(body.shop[0], {
      id: 101, name: 'Navy Wool Blazer', brand: 'Label', shop: 'Shop', garment: 'tailoring', for: 'the jacket',
      colours: ['Navy'], price_nzd: 450, about: 'Half canvassed.', rated: 84,
    })
    assert.match(content, /His brief: "a wedding on Saturday"\. Put the outfit together\.$/)

    const mine = JSON.parse((buildOutfitMessages({ ...input, source: 'wardrobe', brief: '' })[0]!.content as string).split('\n\nHe gave no brief')[0]!)
    assert.equal(mine.shop, undefined)
    assert.deepEqual(mine.his_pieces, [])
  })
})

describe('an outfit asked for, made and read', () => {
  const scratch = `wardrobe_outfit_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  const own: Record<string, number> = {}

  let nextId = 7000
  function product(title: string, sizes: Record<string, number>) {
    nextId += 10
    const id = nextId
    return ShopifyProductSchema.parse({
      id,
      title,
      handle: `p-${id}`,
      product_type: '',
      tags: [],
      options: [{ name: 'Size', position: 1, values: Object.keys(sizes) }],
      variants: Object.entries(sizes).map(([size, price], index) => ({ id: id + index + 1, option1: size, title: size, price: price.toFixed(2), available: true })),
      images: [{ src: `https://cdn.shopify.com/s/files/${id}.jpg?v=1` }],
    })
  }

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the outfit database test')
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
    const [shopRow] = await sql<{ id: number }[]>`
      insert into retailers (slug, name, platform, base_url, country, currency, catalogue)
      values ('shop', 'Shop', 'shopify', 'https://shop.test', 'NZ', 'NZD', 'menswear')
      returning id::int as id
    `
    const local = { base_url: 'https://shop.test', catalogue: 'menswear' as const }
    await writePage(
      sql,
      shopRow!.id,
      [
        product('Navy Wool Blazer', { S: 450, M: 450 }),
        product('White Oxford Shirt', { M: 120, L: 120 }),
        product('Pink Oxford Shirt', { M: 110 }),
        product('White Poplin Shirt', { S: 130 }),
        product('Charcoal Wool Trousers', { '32': 220 }),
        product('Brown Leather Derby Shoes', { 'UK 9': 300 }),
      ].map((item) => normaliseProduct(item, local)),
    )

    const typed = { source: 'typed' as const, photo_id: null, product_id: null }
    for (const [name, garment_type] of [
      ['Ecru oxford', 'shirt'],
      ['Pine crew', 'knitwear'],
      ['Putty chinos', 'trousers'],
      ['Brown Chelseas', 'boots'],
    ] as const) {
      own[name] = await createPiece(
        { name, garment_type, colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, worn_for: 'everyday', brand: null, size: null, notes: null, slot_id: null },
        typed,
      )
    }
  })

  after(async () => {
    await sql?.end()
    await db().end()
    await admin.unsafe(`drop database if exists ${scratch} with (force)`)
    await admin.end()
  })

  const meta = { model: 'claude-opus-5-5', served_by: 'claude-opus-5-5', input_tokens: 10_000, output_tokens: 1_000, generated_at: '' }
  const plan: Plan = {
    understood: true,
    problem: null,
    wants: [
      { garment_type: 'tailoring', words: ['blazer'], colours: ['navy'], max_nzd: null, role: 'the jacket' },
      { garment_type: 'shirt', words: ['oxford'], colours: ['white'], max_nzd: null, role: 'the shirt' },
      { garment_type: 'trousers', words: ['wool'], colours: ['charcoal'], max_nzd: null, role: 'the trousers' },
      { garment_type: 'shoes', words: ['derby'], colours: ['brown'], max_nzd: null, role: 'the shoes' },
    ],
  }
  const planned = (answer: Plan | null) => async () => ({ plan: answer, usd: 0.01 })
  let seen: ComposeInput | null = null
  /** Opus's answer as a fixture: each outfit names products by title and pieces by name. */
  const composed =
    (...outfits: { products?: string[]; pieces?: string[] }[]) =>
    async (input: ComposeInput): Promise<Composed> => {
      seen = input
      const id = (title: string) => input.pool.find((item) => item.title === title)?.product_id ?? 999_999
      return {
        outfits: outfits.map((outfit) =>
          draft({ piece_ids: (outfit.pieces ?? []).map((name) => own[name]!), shop_items: (outfit.products ?? []).map((title) => ({ id: id(title), why: 'the one' })) }),
        ),
        meta,
        usd: 0.06,
      }
    }

  test('without a style guide it is not started', async () => {
    const started = await startOutfit({ brief: 'a wedding', source: 'shops' }, sql)
    assert.equal(started.ok, false)
    await saveGuide(guideFixture, { model: 'fixture', served_by: 'fixture', input_tokens: 0, output_tokens: 0, generated_at: new Date().toISOString() })
  })

  test('from the shops: planned, found in his size, put together, priced and saved from', async () => {
    const started = await startOutfit({ brief: '  a wedding   on Saturday ', source: 'shops' }, sql)
    assert.ok(started.ok)
    assert.deepEqual(await startOutfit({ brief: '', source: 'wardrobe' }, sql), { ok: false, message: 'Another outfit is still being made. One at a time.' })
    assert.equal((await getOutfit(null, sql))?.status, 'making')

    const outcome = await runOutfit(started.id, {
      sql,
      plan: planned(plan),
      compose: composed({ products: ['Navy Wool Blazer', 'White Oxford Shirt', 'Charcoal Wool Trousers', 'Brown Leather Derby Shoes'], pieces: ['Pine crew'] }),
    })
    assert.equal(outcome, 'ready')
    assert.deepEqual(
      seen!.pool.map((item) => item.title).sort(),
      ['Brown Leather Derby Shoes', 'Charcoal Wool Trousers', 'Navy Wool Blazer', 'White Oxford Shirt'],
      'the pink shirt is the wrong colour and the poplin one is not made in his M',
    )

    const view = await getOutfit(started.id, sql)
    assert.ok(view)
    assert.equal(view.status, 'ready')
    assert.equal(view.brief, 'a wedding on Saturday', 'kept as typed, spaces tidied')
    assert.equal(view.look, null, 'an outfit with the shops in it is not a look')
    assert.deepEqual(
      view.parts.map((part) => part.name),
      ['Navy Wool Blazer', 'White Oxford Shirt', 'Charcoal Wool Trousers', 'Brown Leather Derby Shoes'],
      'outermost first; his knit was left out of an outfit from the shops alone',
    )
    assert.equal(view.to_buy_cents, 109000)
    const shirt = view.parts[1]!.product!
    assert.deepEqual(shirt.sizes, ['M'], 'his size')
    assert.equal(shirt.price.nzdCents, 12000)
    assert.ok(Math.abs(view.usd - 0.07) < 1e-9, 'the plan and the outfit')

    await recordAction({ action: 'saved', product_id: shirt.product_id, slot_id: null }, sql)
    const [saved] = await sql<{ price_cents: number; size: string }[]>`
      select price_cents, size from feed_actions where product_id = ${shirt.product_id}
    `
    assert.deepEqual({ ...saved }, { price_cents: 12000, size: 'M' }, 'saved at the price and size the outfit found')
    const after = await getOutfit(started.id, sql)
    assert.equal(after!.parts[1]!.product!.state, 'saved')

    // "See it on me" takes the outfit's products though only one is saved; with no key it stops there.
    const key = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const tryOn = await startAskedOutfitTryOn(started.id, sql)
    if (key) process.env.OPENAI_API_KEY = key
    assert.deepEqual(tryOn, { ok: false, message: 'Try-on needs an OpenAI key: add OPENAI_API_KEY to the server’s environment.' })
  })

  test('from his wardrobe: the outfit is a look in a set of its own kind, and the first that holds is kept', async () => {
    const started = await startOutfit({ brief: '', source: 'wardrobe' }, sql)
    assert.ok(started.ok)
    const outcome = await runOutfit(started.id, {
      sql,
      plan: async () => assert.fail('nothing is planned for his own wardrobe'),
      compose: composed({ pieces: ['Ecru oxford', 'Pine crew'] }, { pieces: ['Pine crew', 'Putty chinos', 'Brown Chelseas'] }),
    })
    assert.equal(outcome, 'ready')
    const view = await getOutfit(null, sql)
    assert.equal(view!.id, started.id, 'the newest')
    assert.ok(view!.look, 'made only of his pieces, it is a look')
    assert.deepEqual(view!.look.pieces.map((piece) => piece.name), ['Pine crew', 'Putty chinos', 'Brown Chelseas'])
    assert.equal(view!.look.status, 'new')
    const [set] = await sql<{ kind: string; note: string | null }[]>`select kind, note from look_sets where id = ${view!.look.set_id}`
    assert.deepEqual({ ...set }, { kind: 'ask', note: null })
    assert.equal((await readLooks(sql)).latest, null, 'the Looks tab has no set of its own yet')
  })

  test('from both: an outfit that turns out all his own is a look, the one already made', async () => {
    const started = await startOutfit({ brief: 'dinner', source: 'both' }, sql)
    assert.ok(started.ok)
    const outcome = await runOutfit(started.id, {
      sql,
      plan: planned({ understood: true, problem: null, wants: [] }),
      compose: composed({ pieces: ['Brown Chelseas', 'Putty chinos', 'Pine crew'] }),
    })
    assert.equal(outcome, 'ready')
    const [first, second] = [await getOutfit(started.id, sql), (await listOutfits(9, sql))[1]!]
    const earlier = await getOutfit(second.id, sql)
    assert.equal(first!.look!.id, earlier!.look!.id, 'the same pieces are the same look')
  })

  test('from anything: nothing is planned or read from the shops, and the garments described are kept as written', async () => {
    const started = await startOutfit({ brief: 'a gallery opening', source: 'anywhere' }, sql)
    assert.ok(started.ok)
    const idea = (garment_type: 'knitwear' | 'trousers' | 'boots', name: string) => ({
      garment_type, name, colour_name: 'oxblood', colour_hex: '#7A2E1F', fabric: 'merino', fit: null, why: 'the colour near your face', search: name.toLowerCase(),
    })
    const outcome = await runOutfit(started.id, {
      sql,
      plan: async () => assert.fail('nothing is planned for an outfit from anything'),
      compose: async (input) => {
        assert.deepEqual(input.pool, [])
        return { outfits: [draft({ ideas: [idea('boots', 'Brown suede chukkas'), idea('knitwear', 'Oxblood merino crew'), idea('trousers', 'Chocolate wool trousers')] })], meta, usd: 0.05 }
      },
    })
    assert.equal(outcome, 'ready')
    const view = await getOutfit(started.id, sql)
    assert.equal(view!.look, null)
    assert.equal(view!.on_me, null)
    assert.equal(view!.to_buy_cents, 0)
    assert.deepEqual(view!.parts.map((part) => part.name), ['Oxblood merino crew', 'Chocolate wool trousers', 'Brown suede chukkas'])
    assert.deepEqual(view!.parts[0]!.idea, {
      garment_type: 'knitwear', name: 'Oxblood merino crew', colour_name: 'oxblood', colour_hex: '#7a2e1f', fabric: 'merino', fit: null,
      why: 'the colour near your face', search: 'oxblood merino crew',
    })
    assert.deepEqual(await startAskedOutfitTryOn(started.id, sql), { ok: false, message: 'Only an outfit whose every piece has a picture can be put on you.' })
  })

  test('a brief that is not about getting dressed fails in Claude’s words; an outfit that does not hold fails in ours', async () => {
    const odd = await startOutfit({ brief: 'the weather in Lisbon', source: 'shops' }, sql)
    assert.ok(odd.ok)
    assert.equal(await runOutfit(odd.id, { sql, plan: planned({ understood: false, problem: 'That is not something to dress for.', wants: [] }) }), 'failed')
    assert.equal((await getOutfit(odd.id, sql))!.error, 'That is not something to dress for.')

    const loose = await startOutfit({ brief: 'a wedding', source: 'shops' }, sql)
    assert.ok(loose.ok)
    assert.equal(await runOutfit(loose.id, { sql, plan: planned(plan), compose: composed({ products: ['Navy Wool Blazer', 'White Oxford Shirt'] }) }), 'failed')
    const view = await getOutfit(loose.id, sql)
    assert.equal(view!.error, 'The outfit Claude made did not hold together. Try again.')
    assert.deepEqual(view!.parts, [])
  })
})
