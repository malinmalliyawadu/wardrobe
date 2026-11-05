import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MODELS } from '../src/lib/claude.ts'
import {
  buildStatementRequest,
  ceilings,
  rankCandidates,
  statementContextBlock,
  statementFamilies,
  statementSignals,
  StatementSchema,
  tidyStatement,
  wearablePieces,
  type ProductForStatement,
} from '../src/lib/finder/statements.ts'
import type { Piece } from '../src/lib/pieces.ts'
import { qualitiesText } from '../src/lib/statements.ts'
import type { Guide } from '../src/lib/style-guide.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

/* The statement rules and the judge's request, without a database or Claude. */

const guide: Pick<Guide, 'palette'> = {
  palette: {
    ...guideFixture.palette,
    best: [
      { hex: '#2f4a3a', name: 'pine', use: 'knitwear' },
      { hex: '#7a2e1f', name: 'oxblood', use: 'knitwear' },
      { hex: '#8a4a2a', name: 'tobacco', use: 'outerwear' },
      { hex: '#a0522d', name: 'brick', use: 'shirts' },
    ],
  },
}

const listing = (title: string, extra: Partial<Parameters<typeof statementSignals>[0]> = {}) => ({
  product_id: 1,
  content_hash: 'h',
  title,
  vendor: null,
  product_type: null,
  tags: [],
  garment_type: 'shirt' as const,
  colours: [],
  image_src: null,
  image_colour_src: null,
  image_colours: null,
  ...extra,
})

test('his bold colours are his best colours that are not neutrals, however deep', () => {
  assert.deepEqual(statementFamilies(guide).sort(), ['green', 'red', 'rust'], 'tobacco is a brown, so a neutral')
  assert.deepEqual(statementFamilies(null), [], 'no guide, no bold colours')
})

test('the rules pick a piece for a bold colour of his, a texture or a cut, and never for a pattern', () => {
  const bold = statementFamilies(guide)
  assert.deepEqual(statementSignals(listing('Rust Linen Shirt'), bold), ['colour'])
  assert.deepEqual(statementSignals(listing('Navy Linen Shirt'), bold), [], 'navy is a neutral')
  assert.deepEqual(statementSignals(listing('Oxford Shirt', { colours: ['Ecru', 'Brick'] }), bold), ['colour'], 'any colour in his size')
  assert.deepEqual(statementSignals(listing('Corduroy Shirt - Navy'), bold), ['texture'])
  assert.deepEqual(statementSignals(listing('Bouclé Polo'), bold), ['texture'], 'an accent is read as its plain letter')
  assert.deepEqual(statementSignals(listing('Poker Jacket', { tags: ['_Boucle'] }), bold), ['texture'], 'a material tag counts')
  assert.deepEqual(statementSignals(listing('Pine Cuban Collar Shirt'), bold), ['colour', 'cut'])
  assert.deepEqual(statementSignals(listing('Slim Pant', { tags: [':Cropped', 'Wide Leg'] }), bold), [], 'a cut only from the title: stores tag whole categories')
  assert.deepEqual(statementSignals(listing('Padded Jacket', { tags: ['Padded/Quilted Jackets'] }), bold), [], 'every puffer is quilted')
  assert.deepEqual(statementSignals(listing('Check Flannel Shirt'), bold), [], 'a pattern alone is not what he means')
  assert.deepEqual(statementSignals(listing('Drawcord Trouser'), bold), [], 'a drawcord is not cord')
  assert.deepEqual(
    statementSignals(listing('Suede Loafer', { garment_type: 'shoes' }), bold),
    [],
    'every loafer is suede or leather: a shoe is picked by colour or cut alone',
  )
  assert.deepEqual(statementSignals(listing('Tassel Loafer', { garment_type: 'shoes' }), bold), ['cut'])
  assert.deepEqual(
    statementSignals(
      listing('Overshirt', { image_src: 'https://x.test/a.jpg?v=2', image_colour_src: 'https://x.test/a.jpg', image_colours: ['#a0522d'] }),
      bold,
    ),
    ['colour'],
    'with no colour in the words, the photo read decides',
  )
})

test('two signals first, then the garments that carry an outfit, then the newest', () => {
  const at = (day: number) => new Date(`2026-11-0${day}`)
  const rows = [
    { product_id: 1, signals: ['colour' as const], garment_type: 'trousers' as const, first_seen_at: at(4) },
    { product_id: 2, signals: ['colour' as const], garment_type: 'jacket' as const, first_seen_at: at(1) },
    { product_id: 3, signals: ['colour' as const, 'texture' as const], garment_type: 'sneakers' as const, first_seen_at: at(1) },
    { product_id: 4, signals: ['colour' as const], garment_type: 'jacket' as const, first_seen_at: at(3) },
  ]
  assert.deepEqual(rankCandidates(rows).map((row) => row.product_id), [3, 4, 2, 1])
})

test('the most he would pay: his budget for the kind, else the top of the blueprint’s bands, else none', () => {
  const result = ceilings({ knits: 250, outerwear: null }, [
    { garment_type: 'jacket', budget_max_cents: 60000 },
    { garment_type: 'jacket', budget_max_cents: 90000 },
    { garment_type: 'knitwear', budget_max_cents: 40000 },
    { garment_type: 'shirt', budget_max_cents: null },
  ])
  assert.equal(result.knitwear, 25000, 'his own number wins')
  assert.equal(result.sweatshirt, 25000, 'knits covers sweatshirts too')
  assert.equal(result.jacket, 90000)
  assert.equal(result.shirt, undefined)
})

const product: ProductForStatement = {
  product_id: 7,
  content_hash: 'abc',
  retailer: 'END.',
  title: 'Corduroy Harrington Jacket',
  vendor: 'Universal Works',
  product_type: null,
  tags: [],
  body_html: '<p>Eight-wale cord.</p>',
  images: [{ src: 'https://cdn.shopify.com/s/files/1/x/files/jacket.jpg?v=1', width: 2000, height: 2500, alt: null }],
  colours: ['Rust', 'Navy'],
  sizes: ['S'],
  signals: ['colour', 'texture'],
}

test('the judge is Sonnet at low effort, the context cached, the photo and the listing after it', () => {
  const request = buildStatementRequest('context', product)
  assert.equal(request.model, MODELS.scoring)
  assert.equal(request.output_config.effort, 'low')
  assert.deepEqual(request.system[1], { type: 'text', text: 'context', cache_control: { type: 'ephemeral' } })
  const [image, text] = request.messages[0]!.content as { type: string; text?: string; source?: { url: string } }[]
  assert.equal(image!.type, 'image')
  assert.match(image!.source!.url, /width=768/)
  assert.match(text!.text!, /Eight-wale cord\./)
  assert.match(text!.text!, /picked it for its colour and texture/)
})

const piece = (id: number, name: string, fields: Partial<Piece> = {}): Piece =>
  ({ id, name, garment_type: 'trousers', colour_hex: null, colour_name: 'ink navy', fabric: 'cotton', fit: 'slim', worn_for: 'everyday', set_aside_at: null, ...fields }) as Piece

test('the context names the pieces he can wear it with, and says so when there are none', () => {
  const pieces = [
    piece(1, 'Ink navy chinos'),
    piece(2, 'Gym shorts', { worn_for: 'gym' }),
    piece(3, 'Old jumper', { set_aside_at: new Date() }),
  ]
  assert.deepEqual(wearablePieces(pieces).map((p) => p.id), [1])
  const block = statementContextBlock({ profile: profileFixture, guide: guideFixture, pieces, dismissals: [] })
  assert.match(block, /"name":"Ink navy chinos"/)
  assert.doesNotMatch(block, /Gym shorts|Old jumper/)
  assert.match(
    statementContextBlock({ profile: profileFixture, guide: guideFixture, pieces: [], dismissals: [] }),
    /leave wears_with empty/,
  )
})

test('tidying holds the verdict to what was offered, and nothing that stands out stays under the bar', () => {
  const parsed = StatementSchema.parse({
    qualities: ['texture', 'colour', 'texture'],
    score: 89,
    colour: 'Rust',
    why: 'Rust cord — the jacket to wear with your navy chinos.',
    wears_with: [1, 99, 1, 2, 3, 4],
  })
  const tidied = tidyStatement(parsed, product, new Set([1, 2, 3, 4]))
  assert.deepEqual(tidied.qualities, ['colour', 'texture'])
  assert.equal(tidied.score, 89)
  assert.equal(tidyStatement({ ...parsed, score: 120 }, product, new Set()).score, 100)
  assert.equal(tidied.colour, 'Rust')
  assert.equal(tidied.why, 'Rust cord - the jacket to wear with your navy chinos.')
  assert.deepEqual(tidied.wears_with, [1, 2, 3], 'his pieces only, once each, three at most')
  assert.equal(tidyStatement({ ...parsed, colour: 'Teal' }, product, new Set()).colour, null, 'not on sale in his size')
  assert.equal(tidyStatement({ ...parsed, qualities: [] }, product, new Set()).score, 39)
  assert.ok(!StatementSchema.safeParse({ ...parsed, score: 101 }).success)
})

test('what makes it one, in words', () => {
  assert.equal(qualitiesText(['colour']), 'Colour')
  assert.equal(qualitiesText(['colour', 'texture']), 'Colour and texture')
  assert.equal(qualitiesText(['colour', 'texture', 'cut']), 'Colour, texture and cut')
})
