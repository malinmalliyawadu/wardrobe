import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseFinderSettingsForm, runBudget, statementsBudget, usdText } from '../src/lib/finder/settings.ts'

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

test('a run spends up to the nightly limit, never past what is left of the month', () => {
  const settings = { max_usd_per_run: 1, max_usd_per_month: 10, max_usd_per_search: 0.5, max_usd_statements: 0.5 }
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

test('statement pieces spend up to their own nightly limit, inside what the month has left', () => {
  const settings = { max_usd_per_run: 1, max_usd_per_month: 10, max_usd_per_search: 0.5, max_usd_statements: 0.4 }
  assert.equal(statementsBudget(settings, 2, null).max_usd, 0.4)
  assert.equal(statementsBudget(settings, 9.8, null).max_usd, 0.2, 'the month, after the slots were judged')
  assert.equal(statementsBudget(settings, 2, 3).max_usd, 3, 'a flag replaces the nightly limit')
  assert.equal(statementsBudget({ ...settings, max_usd_statements: 0 }, 0, null).max_usd, 0, '0 turns them off')
})

test('the settings form: dollars to the cent, an optional month, the shops left on', () => {
  const parsed = parseFinderSettingsForm(
    form({
      max_usd_per_run: '1.505',
      max_usd_per_month: '',
      max_usd_per_search: '0.505',
      max_usd_statements: '0.255',
      stores: ['barkers', 'end', 'barkers'],
    }),
  )
  assert.deepEqual(parsed, {
    ok: true,
    data: {
      max_usd_per_run: 1.51,
      max_usd_per_month: null,
      max_usd_per_search: 0.51,
      max_usd_statements: 0.26,
      stores: ['barkers', 'end'],
    },
  })
  assert.deepEqual(parseFinderSettingsForm(form({ max_usd_per_run: '0', max_usd_per_search: '0', max_usd_statements: '0', stores: 'huffer' })), {
    ok: true,
    data: { max_usd_per_run: 0, max_usd_per_month: null, max_usd_per_search: 0, max_usd_statements: 0, stores: ['huffer'] },
  })
})

test('the settings form refuses what makes no sense', () => {
  const missing = parseFinderSettingsForm(form({ max_usd_per_run: '', max_usd_per_search: '0.5', max_usd_statements: '0.5', stores: 'end' }))
  assert.ok(!missing.ok && missing.errors.max_usd_per_run)
  const noSearch = parseFinderSettingsForm(form({ max_usd_per_run: '1', max_usd_per_search: '', max_usd_statements: '0.5', stores: 'end' }))
  assert.ok(!noSearch.ok && noSearch.errors.max_usd_per_search)
  const noStatements = parseFinderSettingsForm(form({ max_usd_per_run: '1', max_usd_per_search: '0.5', stores: 'end' }))
  assert.ok(!noStatements.ok && noStatements.errors.max_usd_statements)
  const negative = parseFinderSettingsForm(form({ max_usd_per_run: '-1', max_usd_per_search: '0.5', max_usd_statements: '0.5', stores: 'end' }))
  assert.ok(!negative.ok && negative.errors.max_usd_per_run)
  const word = parseFinderSettingsForm(form({ max_usd_per_run: 'lots', max_usd_per_search: '0.5', max_usd_statements: '0.5', stores: 'end' }))
  assert.ok(!word.ok && word.errors.max_usd_per_run === 'Enter a number')
  const month = parseFinderSettingsForm(form({ max_usd_per_run: '2', max_usd_per_month: '1', max_usd_per_search: '0.5', max_usd_statements: '0.5', stores: 'end' }))
  assert.ok(!month.ok && month.errors.max_usd_per_month === 'At least the two nightly limits together, US$2.50')
  const both = parseFinderSettingsForm(
    form({ max_usd_per_run: '1', max_usd_per_month: '1.2', max_usd_per_search: '0.5', max_usd_statements: '0.5', stores: 'end' }),
  )
  assert.ok(!both.ok && both.errors.max_usd_per_month, 'the month covers a night of both')
  const noShops = parseFinderSettingsForm(form({ max_usd_per_run: '1', max_usd_per_search: '0.5', max_usd_statements: '0.5' }))
  assert.ok(!noShops.ok && noShops.errors.stores === 'Keep at least one shop on')
})

test('dollars read as dollars', () => {
  assert.equal(usdText(1), 'US$1')
  assert.equal(usdText(0.5), 'US$0.50')
})
