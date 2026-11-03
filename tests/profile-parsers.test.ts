import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseBudgetForm, parseColouringForm, parseSizesForm } from '../src/lib/profile.ts'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

test('sizes: blanks become null, numbers are lenient about commas and spaces', () => {
  const result = parseSizesForm(form({ height_cm: ' 183 ', chest_cm: '102,5', waist_cm: '', tee: 'L', tops: 'regular' }))
  assert.ok(result.ok)
  assert.equal(result.data.height_cm, 183)
  assert.equal(result.data.sizes.chest_cm, 102.5)
  assert.equal(result.data.sizes.waist_cm, null)
  assert.equal(result.data.sizes.tee, 'L')
  assert.equal(result.data.fits.tops, 'regular')
  assert.equal(result.data.fits.knits, null)
})

test('sizes: a word where a number should be is an error on that field only', () => {
  const result = parseSizesForm(form({ chest_cm: 'big', waist_cm: '86' }))
  assert.ok(!result.ok)
  assert.deepEqual(Object.keys(result.errors), ['chest_cm'])
})

test('sizes: height outside the human range is refused', () => {
  const result = parseSizesForm(form({ height_cm: '18' }))
  assert.ok(!result.ok)
  assert.match(result.errors.height_cm ?? '', /100 and 250/)
})

test('sizes: an unknown fit value is refused', () => {
  const result = parseSizesForm(form({ tops: 'baggy' }))
  assert.ok(!result.ok)
  assert.equal(result.errors.tops, 'Pick one of the options')
})

test('budget: whole dollars only, bounded', () => {
  assert.ok(parseBudgetForm(form({ monthly: '400', shoes: '350' })).ok)
  const fraction = parseBudgetForm(form({ monthly: '400.50' }))
  assert.ok(!fraction.ok)
  assert.ok(fraction.errors.monthly)
  const huge = parseBudgetForm(form({ shoes: '250000' }))
  assert.ok(!huge.ok)
  assert.equal(huge.errors.shoes, 'At most 100000')
})

test('colouring: enums are validated, free text passes through', () => {
  const ok = parseColouringForm(form({ season: 'deep autumn', undertone: 'warm', hair_colour: 'dark brown', build: 'athletic' }))
  assert.ok(ok.ok)
  assert.equal(ok.data.season, 'deep autumn')
  assert.equal(ok.data.skin_depth, null)

  const bad = parseColouringForm(form({ season: 'monsoon' }))
  assert.ok(!bad.ok)
  assert.equal(bad.errors.season, 'Pick one of the options')
})
