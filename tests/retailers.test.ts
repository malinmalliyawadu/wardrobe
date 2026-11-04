import assert from 'node:assert/strict'
import { test } from 'node:test'

import { tryOnAt } from '../src/lib/retailers.ts'
import { readRetailerFile } from '../scripts/seed-retailers.ts'

/** "www.barkersonline.co.nz" and "barkersonline.co.nz" are one site. */
const site = (url: string) => new URL(url).hostname.replace(/^www\./, '')

test('every verified Wellington store cites a page on the retailer’s own site', () => {
  for (const retailer of readRetailerFile()) {
    const store = retailer.wellington_store
    if (!store?.verified) continue
    assert.ok(store.source, `${retailer.slug} has no source`)
    assert.equal(site(store.source), site(retailer.base_url), `${retailer.slug} cites another site`)
    assert.match(store.address ?? '', /\d|corner/, `${retailer.slug}'s address names no number or corner`)
  }
})

test('"try on at" names a store only once it is verified', () => {
  const store = { name: 'Barkers', area: 'Lambton Quay', address: '342 Lambton Quay', verified: false }
  assert.equal(tryOnAt(store), null)
  assert.equal(tryOnAt(null), null)
  assert.equal(tryOnAt({ ...store, verified: true }), 'Barkers, 342 Lambton Quay')
})
