import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  RequestReadSchema,
  SEARCH_PREAMBLE,
  SEARCH_SLOT,
  rankForRequest,
  searchBudget,
  searchContextBlock,
  searchTarget,
  targetLine,
  type RequestRead,
} from '../src/lib/search.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

/* On-demand search: the parts that need no database and no Claude. */

const overshirt: RequestRead & { garment_type: 'overshirt' } = {
  understood: true,
  garment_type: 'overshirt',
  words: ['overshirt', 'Wool '],
  colours: ['Navy'],
  min_nzd: null,
  max_nzd: 300,
  fit: null,
  fabrics: ['wool'],
  summary: 'A navy overshirt under $300',
  problem: null,
}

test('a read request becomes the filter’s target: his size, the price, the colours and their neighbours', () => {
  const target = searchTarget(overshirt, { tee: 'M' }, () => ['regular', 'relaxed'])
  assert.equal(target.slot_id, SEARCH_SLOT)
  assert.equal(target.garment_type, 'overshirt')
  assert.equal(target.max_cents, 30000)
  assert.equal(target.min_cents, null)
  assert.ok(target.sizes?.includes('M'), 'his tee size reads as his top size')
  assert.ok(target.families?.includes('navy'))
  assert.ok(target.families?.includes('blue'), 'a neighbour of navy is not plainly wrong')
  assert.deepEqual(target.fits, ['regular', 'relaxed'], 'with no cut asked for, the guide’s')
  assert.deepEqual(target.words, ['overshirt', 'wool'], 'words and fabrics, lowercase, once each')
  assert.deepEqual(target.colours, ['navy'])
})

test('a cut he names replaces the guide’s; prices given backwards are put right', () => {
  const target = searchTarget({ ...overshirt, fit: 'oversized', min_nzd: 300, max_nzd: 150 }, {}, () => ['slim'])
  assert.deepEqual(target.fits, ['oversized'])
  assert.equal(target.min_cents, 15000)
  assert.equal(target.max_cents, 30000)
  assert.equal(target.sizes, null, 'his size unknown: any size in stock')
})

test('an accessory request narrows to its kind', () => {
  const beanie = searchTarget(
    { ...overshirt, garment_type: 'accessory', words: ['beanie'], fabrics: ['merino'], summary: 'A brown merino beanie' },
    {},
    () => [],
  )
  assert.equal(beanie.kind, 'beanie')
})

test('candidates go to Claude closest to his words first, so the cap cuts the furthest', () => {
  const product = (product_id: number, title: string, extra: Partial<{ tags: string[]; body_html: string; colours: string[] }> = {}) => ({
    product_id,
    title,
    vendor: null,
    product_type: null,
    tags: extra.tags ?? [],
    body_html: extra.body_html ?? null,
    colours: extra.colours ?? [],
  })
  const ranked = rankForRequest(
    [
      product(1, 'Cotton Shirt Jacket'),
      product(2, 'Wool Overshirt', { colours: ['Olive'] }),
      product(3, 'Shirt Jacket', { body_html: '<p>A heavy wool overshirt.</p>' }),
      product(4, 'Wool Overshirts', { colours: ['Navy'] }),
      product(5, 'Plain Overshirt'),
    ],
    { words: ['overshirt', 'wool'], colours: ['navy'] },
  )
  assert.deepEqual(
    ranked.map((item) => item.product_id),
    [4, 2, 5, 3, 1],
    'both words in the title and his colour, then both words, then one, then the description, then nothing',
  )
})

test('a search spends its own limit, never past what is left of the month', () => {
  assert.equal(searchBudget(0.5, null, 40), 0.5)
  assert.equal(searchBudget(0.5, 10, 2), 0.5)
  assert.equal(searchBudget(0.5, 10, 9.8), 0.2)
  assert.equal(searchBudget(0.5, 10, 12), 0)
})

test('the line under the heading says what was understood', () => {
  const target = searchTarget(overshirt, { tee: 'M' }, () => [])
  assert.equal(targetLine(target), 'Overshirts in navy, up to $300, in your size.')
  const chinos = searchTarget(
    { ...overshirt, garment_type: 'trousers', colours: [], min_nzd: 100, max_nzd: 200, fit: 'relaxed' },
    {},
    () => [],
  )
  assert.equal(targetLine(chinos), 'Trousers, relaxed cut, $100 to $200, in any size in stock.')
})

test('the scorer is told the request is the only slot, in his words', () => {
  const target = searchTarget(overshirt, { tee: 'M' }, () => [])
  const block = searchContextBlock({
    profile: profileFixture,
    guide: guideFixture,
    request: 'a navy overshirt under $300',
    summary: overshirt.summary,
    target,
    dismissals: [],
  })
  assert.ok(block.startsWith(SEARCH_PREAMBLE))
  assert.match(block, /"id":0,"name":"A navy overshirt under \$300"/)
  assert.match(block, /He asked for this himself: \\"a navy overshirt under \$300\\"/)
  assert.match(block, /"budget_nzd":\{"min":null,"max":300\}/)
  assert.doesNotMatch(block, /dismissed lately/, 'no dismissals, no section')
})

test('the read schema takes an answer Claude would give and refuses a garment off the list', () => {
  assert.ok(RequestReadSchema.safeParse(overshirt).success)
  assert.ok(!RequestReadSchema.safeParse({ ...overshirt, garment_type: 'dress' }).success)
})
