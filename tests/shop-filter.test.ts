import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chosenShop, FROM_A_PHOTO, shopOptions, withShop } from '../src/lib/shop-filter.ts'

const finds = [
  { shop: 'uniqlo', retailer: 'Uniqlo AU' },
  { shop: 'photo', retailer: 'From a photo', fromPhoto: true },
  { shop: 'barkers', retailer: 'Barkers' },
  { shop: 'uniqlo', retailer: 'Uniqlo AU' },
  { shop: 'end', retailer: 'END.' },
]

test('each shop in the list once, by name, with wishes from a photo last', () => {
  assert.deepEqual(shopOptions(finds), [
    { value: 'barkers', label: 'Barkers' },
    { value: 'end', label: 'END.' },
    { value: 'uniqlo', label: 'Uniqlo AU' },
    { value: 'photo', label: FROM_A_PHOTO },
  ])
  assert.deepEqual(shopOptions([]), [])
})

test('a shop the list does not have shows everything', () => {
  const options = shopOptions(finds)
  assert.equal(chosenShop('end', options), 'end')
  assert.equal(chosenShop(['barkers', 'end'], options), 'barkers')
  assert.equal(chosenShop('huffer', options), null)
  assert.equal(chosenShop(undefined, options), null)
  assert.equal(chosenShop('', options), null)
})

test('the shop joins the other parameters, and clearing it leaves them', () => {
  assert.equal(withShop('/wishlist', {}, 'end'), '/wishlist?shop=end')
  assert.equal(withShop('/wishlist', {}, null), '/wishlist')
  assert.equal(withShop('/statements', { by: 'cut' }, 'rodd-and-gunn'), '/statements?by=cut&shop=rodd-and-gunn')
  assert.equal(withShop('/statements', { by: null }, null), '/statements')
})
