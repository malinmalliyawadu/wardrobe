import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GuideSchema,
  buildGuideMessages,
  colourNameFor,
  normaliseGuide,
  parseFitsForm,
  parsePaletteForm,
  parseSectionForm,
  parseStoredGuide,
  profileBrief,
} from '../src/lib/style-guide.ts'
import { normaliseHex } from '../src/lib/wardrobe-values.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

test('hex values are normalised, and anything else is refused', () => {
  assert.equal(normaliseHex('#7A2E1F'), '#7a2e1f')
  assert.equal(normaliseHex(' abc '), '#aabbcc')
  assert.equal(normaliseHex('#12345'), null)
  assert.equal(normaliseHex('oxblood'), null)
})

test('the guide schema accepts a full guide and rejects an unknown metal', () => {
  assert.ok(GuideSchema.safeParse(guideFixture).success)
  const bad = structuredClone(guideFixture) as unknown as { palette: { metal: string } }
  bad.palette.metal = 'bronze'
  assert.ok(!GuideSchema.safeParse(bad).success)
})

test('normalising a guide tidies hex, drops unusable colours and orders fits', () => {
  const messy = structuredClone(guideFixture)
  messy.palette.best.push({ hex: 'not a colour', name: 'mystery', use: '' })
  messy.palette.best[0]!.hex = '#7A2E1F'
  const tidy = normaliseGuide(messy)
  assert.equal(tidy.palette.best.length, 2)
  assert.equal(tidy.palette.best[0]?.hex, '#7a2e1f')
  assert.deepEqual(tidy.fit_vocabulary[0]?.fits, ['slim', 'regular'])
})

test('a stored guide needs generated_at and a current shape', () => {
  const row = { ...guideFixture, model: 'm', generated_at: new Date(), edited_at: null }
  assert.ok(parseStoredGuide(row))
  assert.equal(parseStoredGuide({ ...row, generated_at: null }), null)
  assert.equal(parseStoredGuide({ ...row, palette: {} }), null)
  assert.equal(parseStoredGuide(undefined), null)
})

test('colour names come from the palette, best then neutrals', () => {
  assert.equal(colourNameFor(guideFixture, '#33221a'), 'dark chocolate')
  assert.equal(colourNameFor(guideFixture, '#000000'), null)
  assert.equal(colourNameFor(null, '#33221a'), null)
})

test('the brief leaves out empty groups and carries the season table', () => {
  const brief = profileBrief(profileFixture)
  assert.ok(!('life_days_per_week' in brief), 'empty life is left out')
  assert.ok(!('budget_ceilings_nzd' in brief), 'empty budget is left out')
  const sizes = brief.sizes as Record<string, unknown>
  assert.deepEqual(sizes, { tee: 'S' })
  const table = brief.season_table as Record<string, { role: string }>
  assert.equal(table['deep autumn']?.role, 'his confirmed season')
  const messages = buildGuideMessages(profileFixture)
  assert.equal(messages.length, 1)
  assert.match(String(messages[0]?.content), /deep autumn/)
})

test('palette form: rows are read in order, blank rows are ignored, errors name the row', () => {
  const ok = parsePaletteForm(
    form({
      summary: 'Deep and warm.',
      'best.0.hex': '7A2E1F',
      'best.0.name': 'oxblood',
      'best.0.use': 'knits',
      'best.1.hex': '',
      'best.1.name': '',
      'best.1.use': '',
      'neutrals.0.hex': '#33221a',
      'neutrals.0.name': 'chocolate',
      metal: 'gold',
      metal_why: 'Warm.',
    }),
  )
  assert.ok(ok.ok)
  assert.equal(ok.data.best.length, 1)
  assert.equal(ok.data.best[0]?.hex, '#7a2e1f')
  assert.equal(ok.data.neutrals[0]?.use, '')

  const bad = parsePaletteForm(form({ 'best.3.hex': 'red', 'best.3.name': 'red', metal: 'gold' }))
  assert.ok(!bad.ok)
  assert.equal(bad.errors['best.3.hex'], 'Use a hex value like #7a2e1f')

  const empty = parsePaletteForm(form({ metal: 'gold' }))
  assert.ok(!empty.ok)
  assert.ok(empty.errors.best)

  const metal = parsePaletteForm(form({ 'best.0.hex': '#7a2e1f', 'best.0.name': 'oxblood', metal: 'bronze' }))
  assert.ok(!metal.ok)
  assert.equal(metal.errors.metal, 'Pick one of the options')
})

test('section form: a half-filled rule is an error on the missing half', () => {
  const ok = parseSectionForm(form({ summary: 'Long line.', 'rules.0.topic': 'Rise', 'rules.0.rule': 'Mid.' }))
  assert.ok(ok.ok)
  assert.deepEqual(ok.data.rules, [{ topic: 'Rise', rule: 'Mid.' }])
  const bad = parseSectionForm(form({ 'rules.2.topic': 'Rise' }))
  assert.ok(!bad.ok)
  assert.ok(bad.errors['rules.2.rule'])
})

test('fits form: ticked fits come back in canonical order, duplicates and empty rows are errors', () => {
  const ok = parseFitsForm(form({ 'fits.0.garment': 'tee', 'fits.0.regular': 'on', 'fits.0.slim': 'on', 'fits.0.note': 'x' }))
  assert.ok(ok.ok)
  assert.deepEqual(ok.data[0]?.fits, ['slim', 'regular'])
  const dupe = parseFitsForm(form({ 'fits.0.garment': 'tee', 'fits.0.slim': 'on', 'fits.1.garment': 'tee', 'fits.1.slim': 'on' }))
  assert.ok(!dupe.ok)
  assert.equal(dupe.errors['fits.1.garment'], 'Already listed above')
  const none = parseFitsForm(form({ 'fits.0.garment': 'tee', 'fits.0.note': 'x' }))
  assert.ok(!none.ok)
})
