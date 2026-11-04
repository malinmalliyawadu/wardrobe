import assert from 'node:assert/strict'
import { test } from 'node:test'

import { newsSince, savedHistory, type Observation } from '../src/lib/saved-history.ts'

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 13))
const obs = (variant_id: number, size_key: string | null, n: number, price_cents: number, available = true): Observation => ({
  variant_id,
  size_key,
  observed_at: day(n),
  price_cents,
  available,
})

test('a sale after saving is a drop, and the lowest since saving', () => {
  const history = savedHistory(
    [obs(1, 'M', 1, 24900), obs(2, 'L', 1, 24900), obs(1, 'M', 5, 19900), obs(2, 'L', 5, 19900)],
    { savedAt: day(2), sizeKeys: ['M'] },
  )
  assert.deepEqual(history.events, [{ kind: 'cheaper', at: day(5), from: 24900, to: 19900 }])
  assert.equal(history.lowest, 19900)
})

test('changes before he saved it are not news', () => {
  const history = savedHistory([obs(1, 'M', 1, 24900), obs(1, 'M', 2, 19900)], { savedAt: day(3), sizeKeys: ['M'] })
  assert.deepEqual(history.events, [])
  assert.equal(history.lowest, 19900)
})

test('only his size counts when it is known', () => {
  const history = savedHistory(
    [obs(1, 'M', 1, 24900), obs(2, 'XL', 1, 24900), obs(2, 'XL', 4, 9900), obs(2, 'XL', 5, 9900, false)],
    { savedAt: day(2), sizeKeys: ['M'] },
  )
  assert.deepEqual(history.events, [])
})

test('his size selling out and coming back', () => {
  const history = savedHistory(
    [obs(1, 'M', 1, 24900), obs(2, 'L', 1, 24900), obs(1, 'M', 3, 24900, false), obs(1, 'M', 6, 22900)],
    { savedAt: day(2), sizeKeys: ['M'] },
  )
  assert.deepEqual(history.events, [
    { kind: 'back', at: day(6), price: 22900 },
    { kind: 'sold_out', at: day(3) },
  ])
})

test('with his size unknown, any size in stock counts', () => {
  const history = savedHistory(
    [obs(1, 'M', 1, 24900), obs(2, 'L', 1, 26900), obs(1, 'M', 3, 24900, false)],
    { savedAt: day(2), sizeKeys: null },
  )
  // M sold out but L is still there: dearer, not sold out.
  assert.deepEqual(history.events, [{ kind: 'dearer', at: day(3), from: 24900, to: 26900 }])
})

test('a size change that leaves the lowest price alone is no event', () => {
  const history = savedHistory(
    [obs(1, 'M', 1, 24900), obs(2, 'L', 1, 24900), obs(2, 'L', 3, 24900, false)],
    { savedAt: day(2), sizeKeys: null },
  )
  assert.deepEqual(history.events, [])
  assert.equal(history.lowest, 24900)
})

test('the news is the newest change, only since the run started, and never a rise', () => {
  const { events } = savedHistory(
    [obs(1, 'M', 1, 24900), obs(1, 'M', 3, 19900), obs(1, 'M', 6, 24900)],
    { savedAt: day(2), sizeKeys: ['M'] },
  )
  // Back up last night: not news, and the earlier drop is not reported either.
  assert.equal(newsSince(events, day(6)), null)
  assert.equal(newsSince(events, day(3)), null)
  const dropped = savedHistory([obs(1, 'M', 1, 24900), obs(1, 'M', 6, 19900)], { savedAt: day(2), sizeKeys: ['M'] })
  assert.deepEqual(newsSince(dropped.events, day(6)), { kind: 'cheaper', at: day(6), from: 24900, to: 19900 })
  assert.equal(newsSince(dropped.events, day(7)), null)
  assert.equal(newsSince(dropped.events, null), null)
})

test('when a change happened, said the way he would say it', async () => {
  const { whenSaid } = await import('../src/lib/format.ts')
  // 4 Nov 2026, 9am in Wellington (NZDT, UTC+13).
  const now = new Date('2026-11-03T20:00:00Z')
  assert.equal(whenSaid(new Date('2026-11-03T14:30:00Z'), now), 'last night') // 3:30am today
  assert.equal(whenSaid(new Date('2026-11-03T08:00:00Z'), now), 'last night') // 9pm yesterday
  assert.equal(whenSaid(new Date('2026-11-03T19:30:00Z'), now), 'today') // 8:30am today
  assert.equal(whenSaid(new Date('2026-11-03T00:00:00Z'), now), 'yesterday') // 1pm yesterday
  assert.equal(whenSaid(new Date('2026-11-01T00:00:00Z'), now), 'on Sunday')
  assert.equal(whenSaid(new Date('2026-10-20T00:00:00Z'), now), 'on 20 October')
})
