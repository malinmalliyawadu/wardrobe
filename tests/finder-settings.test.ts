import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseFinderSettingsForm, runBudget, usdText } from '../src/lib/finder/settings.ts'

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

test('a run spends up to the nightly limit, never past what is left of the month', () => {
  const settings = { max_usd_per_run: 1, max_usd_per_month: 10 }
  assert.deepEqual(runBudget(settings, 2.5, null), {
    max_usd: 1, limited_by: 'night', per_run: 1, per_month: 10, spent_this_month: 2.5,
  })
  assert.equal(runBudget(settings, 9.4, null).max_usd, 0.6)
  assert.equal(runBudget(settings, 9.4, null).limited_by, 'month')
  assert.equal(runBudget(settings, 12, null).max_usd, 0, 'over the month already: nothing more')
  assert.equal(runBudget(settings, 2, 5).max_usd, 5, 'a flag replaces the nightly limit')
  assert.equal(runBudget(settings, 8, 5).max_usd, 2, 'but not the monthly one')
  assert.equal(runBudget({ ...settings, max_usd_per_month: null }, 500, 3).max_usd, 3)
})

test('the settings form: dollars to the cent, an optional month, the shops left on', () => {
  const parsed = parseFinderSettingsForm(
    form({ max_usd_per_run: '1.505', max_usd_per_month: '', stores: ['barkers', 'end', 'barkers'] }),
  )
  assert.deepEqual(parsed, {
    ok: true,
    data: { max_usd_per_run: 1.51, max_usd_per_month: null, stores: ['barkers', 'end'] },
  })
  assert.deepEqual(parseFinderSettingsForm(form({ max_usd_per_run: '0', stores: 'huffer' })), {
    ok: true,
    data: { max_usd_per_run: 0, max_usd_per_month: null, stores: ['huffer'] },
  })
})

test('the settings form refuses what makes no sense', () => {
  const missing = parseFinderSettingsForm(form({ max_usd_per_run: '', stores: 'end' }))
  assert.ok(!missing.ok && missing.errors.max_usd_per_run)
  const negative = parseFinderSettingsForm(form({ max_usd_per_run: '-1', stores: 'end' }))
  assert.ok(!negative.ok && negative.errors.max_usd_per_run)
  const word = parseFinderSettingsForm(form({ max_usd_per_run: 'lots', stores: 'end' }))
  assert.ok(!word.ok && word.errors.max_usd_per_run === 'Enter a number')
  const month = parseFinderSettingsForm(form({ max_usd_per_run: '2', max_usd_per_month: '1', stores: 'end' }))
  assert.ok(!month.ok && month.errors.max_usd_per_month === 'At least the nightly limit')
  const noShops = parseFinderSettingsForm(form({ max_usd_per_run: '1' }))
  assert.ok(!noShops.ok && noShops.errors.stores === 'Keep at least one shop on')
})

test('dollars read as dollars', () => {
  assert.equal(usdText(1), 'US$1')
  assert.equal(usdText(0.5), 'US$0.50')
})
