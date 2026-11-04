import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BlueprintSchema,
  buildDraftMessages,
  isKeptOnRedraft,
  parseSlotForm,
  sortDrafts,
  tidyDraft,
  type Slot,
} from '../src/lib/blueprint.ts'
import { band } from '../src/lib/format.ts'
import { finalText, plainDashes } from '../src/lib/structured.ts'

import { draftFixture, guideFixture, profileFixture } from './fixtures.ts'

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

test('the blueprint schema accepts drafts and refuses an unknown garment type or priority', () => {
  assert.ok(BlueprintSchema.safeParse({ slots: [draftFixture] }).success)
  assert.ok(!BlueprintSchema.safeParse({ slots: [{ ...draftFixture, garment_type: 'cape' }] }).success)
  assert.ok(!BlueprintSchema.safeParse({ slots: [{ ...draftFixture, priority: 4 }] }).success)
  assert.ok(!BlueprintSchema.safeParse({ slots: [{ ...draftFixture, status: 'retired' }] }).success)
})

test('tidying keeps palette colours, normalises hex and holds the band under the ceiling', () => {
  const tidy = tidyDraft(
    { ...draftFixture, colours: ['#7A2E1F', '#000000', 'nonsense'], budget_nzd: { min: 300, max: 120 } },
    guideFixture,
    { budget: { knits: 200 } },
  )
  assert.deepEqual(tidy.colours, ['#7a2e1f'], 'off-palette and invalid colours are dropped')
  assert.deepEqual(tidy.budget_nzd, { min: 120, max: 200 }, 'band reordered, then capped by the knits ceiling')

  const offPalette = tidyDraft({ ...draftFixture, colours: ['#000000'] }, guideFixture, { budget: {} })
  assert.deepEqual(offPalette.colours, ['#000000'], 'a valid colour is kept when nothing matches the palette')

  const capped = tidyDraft({ ...draftFixture, budget_nzd: { min: 400, max: 500 } }, guideFixture, { budget: { knits: 200 } })
  assert.deepEqual(capped.budget_nzd, { min: 200, max: 200 })
})

test('drafts sort by priority and keep Claude\'s order within one', () => {
  const sorted = sortDrafts([
    { ...draftFixture, name: 'c', priority: 2 },
    { ...draftFixture, name: 'a', priority: 1 },
    { ...draftFixture, name: 'd', priority: 2 },
    { ...draftFixture, name: 'b', priority: 1 },
  ])
  assert.deepEqual(
    sorted.map((slot) => slot.name),
    ['a', 'b', 'c', 'd'],
  )
})

test('a redraft keeps what Malin wrote, edited, owns or has a candidate for', () => {
  const base = { source: 'claude' as const, edited_at: null, status: 'wanted' as const }
  assert.equal(isKeptOnRedraft(base), false)
  assert.equal(isKeptOnRedraft({ ...base, status: 'retired' }), false)
  assert.equal(isKeptOnRedraft({ ...base, source: 'malin' }), true)
  assert.equal(isKeptOnRedraft({ ...base, edited_at: new Date() }), true)
  assert.equal(isKeptOnRedraft({ ...base, status: 'owned' }), true)
  assert.equal(isKeptOnRedraft({ ...base, status: 'candidate' }), true)
})

test('redraft messages list the kept slots and carry the note', () => {
  const kept = [{ ...draftFixture, id: 1, position: 1, budget_min_cents: 15000, budget_max_cents: 26000 } as unknown as Slot]
  const [message] = buildDraftMessages(profileFixture, guideFixture, kept, 'Fewer knits.')
  const content = String(message?.content)
  assert.match(content, /These 1 slots stay/)
  assert.match(content, /"min": 150/)
  assert.match(content, /Fewer knits\./)
  assert.match(content, /Draft the remaining slots\./)
  const [first] = buildDraftMessages(profileFixture, guideFixture, [], null)
  assert.match(String(first?.content), /Draft his blueprint\./)
})

test('slot form: lists split on commas, colours normalised and de-duplicated', () => {
  const result = parseSlotForm(
    form({
      name: ' Pine overshirt ',
      why: 'Layers.',
      priority: '1',
      garment_type: 'overshirt',
      colours: ['#2F4A3A', '2f4a3a', 'junk'],
      fabrics: 'wool, , cotton',
      size_labels: 'S, M',
      budget_min: '200',
      budget_max: '350',
      fit: 'regular',
    }),
  )
  assert.ok(result.ok)
  assert.equal(result.data.name, 'Pine overshirt')
  assert.deepEqual(result.data.colours, ['#2f4a3a'])
  assert.deepEqual(result.data.fabrics, ['wool', 'cotton'])
  assert.deepEqual(result.data.size_labels, ['S', 'M'])
  assert.equal(result.data.status, null, 'no status field means leave it alone')
})

test('slot form: required fields, enums and the band order are checked', () => {
  const empty = parseSlotForm(form({ priority: '1', garment_type: 'tee' }))
  assert.ok(!empty.ok)
  assert.equal(empty.errors.name, 'Fill this in')

  const bad = parseSlotForm(form({ name: 'x', why: 'y', priority: '5', garment_type: 'cape' }))
  assert.ok(!bad.ok)
  assert.ok(bad.errors.priority)
  assert.equal(bad.errors.garment_type, 'Pick one of the options')

  const band = parseSlotForm(form({ name: 'x', why: 'y', priority: '2', garment_type: 'tee', budget_min: '90', budget_max: '40' }))
  assert.ok(!band.ok)
  assert.equal(band.errors.budget_max, 'At least the lower figure')

  const words = parseSlotForm(form({ name: 'x', why: 'y', priority: '2', garment_type: 'tee', budget_min: 'cheap' }))
  assert.ok(!words.ok)
  assert.equal(words.errors.budget_min, 'Enter a number')
})

test('the answer is the text after the last fallback hop', () => {
  const content = [
    { type: 'text', text: '{"half' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' }, trigger: {} },
    { type: 'text', text: '{"slots":' },
    { type: 'text', text: '[]}' },
  ] as unknown as Parameters<typeof finalText>[0]
  assert.equal(finalText(content), '{"slots":[]}')
})

test('generated copy uses plain dashes', () => {
  assert.deepEqual(plainDashes({ a: ['25\u201328 cm'], b: 'soft \u2014 no padding', c: 3 }), {
    a: ['25-28 cm'],
    b: 'soft - no padding',
    c: 3,
  })
})

test('bands read as Malin would say them', () => {
  assert.equal(band(15000, 26000), '$150 to $260')
  assert.equal(band(120000, 120000), '$1,200')
  assert.equal(band(null, 30000), 'Up to $300')
  assert.equal(band(null, null), null)
})
