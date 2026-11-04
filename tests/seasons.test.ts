import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SEASONS } from '../src/lib/profile-values.ts'
import { SEASON_INFO, seasonName } from '../src/lib/seasons.ts'

test('every season has six valid, named hex swatches, a family that matches its name, and a metal', () => {
  for (const season of SEASONS) {
    const info = SEASON_INFO[season]
    assert.ok(info, `${season} missing`)
    assert.equal(info.swatches.length, 6)
    for (const { hex, name } of info.swatches) {
      assert.match(hex, /^#[0-9a-f]{6}$/, `${season}: ${hex}`)
      assert.match(name, /^[a-z][a-z ]+$/, `${season}: ${hex} is named "${name}"`)
    }
    assert.ok(season.endsWith(info.family), `${season} is filed under ${info.family}`)
    assert.ok(['gold', 'silver', 'mixed'].includes(info.metal))
    assert.ok(info.traits.length > 20)
  }
  assert.equal(Object.keys(SEASON_INFO).length, SEASONS.length)
})

test('season names are title cased', () => {
  assert.equal(seasonName('deep autumn'), 'Deep Autumn')
})
