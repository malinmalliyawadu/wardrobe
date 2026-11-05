import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { colourName } from '../src/lib/finder/colour.ts'
import {
  chooseColour,
  normaliseUniqlo,
  parseUniqloHandle,
  parseUniqloLink,
  readUniqloPage,
  UniqloPageError,
  uniqloHandle,
  uniqloPageUrl,
} from '../src/lib/finder/uniqlo.ts'

/*
 * Uniqlo's product pages, trimmed to the preloaded state's product, saved
 * from uniqlo.com/au/en on 2026-11-05: a sweater in five colours on sale, a
 * pair of jeans sized by waist, and the page for a product that does not exist.
 */
const page = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const sweater = readUniqloPage(page('uniqlo-sweater.html'))!
const jeans = readUniqloPage(page('uniqlo-jeans.html'))!
const store = { base_url: 'https://www.uniqlo.com/au/en' }

test('a Uniqlo link gives its product, price group and colour, from any region', () => {
  assert.deepEqual(parseUniqloLink(new URL('https://www.uniqlo.com/au/en/products/E475296-000/00?colorDisplayCode=09&sizeDisplayCode=004')), {
    productId: 'E475296-000',
    priceGroup: '00',
    colour: '09',
  })
  assert.deepEqual(parseUniqloLink(new URL('https://www.uniqlo.com/uk/en/products/e475296-000/00/')), {
    productId: 'E475296-000',
    priceGroup: '00',
    colour: null,
  })
  assert.equal(parseUniqloLink(new URL('https://www.uniqlo.com/au/en/men/tops')), null)
  assert.equal(parseUniqloLink(new URL('https://www.uniqlo.com/au/en/products/E475296-000/00/products-in-image')), null)
})

test('a handle round-trips, with or without its colour, and makes the page link', () => {
  const link = { productId: 'E475296-000', priceGroup: '00', colour: '09' }
  assert.equal(uniqloHandle(link), 'E475296-000/00/09')
  assert.deepEqual(parseUniqloHandle('E475296-000/00/09'), link)
  assert.deepEqual(parseUniqloHandle('E475296-000/00'), { ...link, colour: null })
  assert.equal(parseUniqloHandle('cot-strap-knit-shirt-60321701'), null, 'a Shopify handle is not one')
  assert.equal(uniqloPageUrl(store.base_url, link), 'https://www.uniqlo.com/au/en/products/E475296-000/00?colorDisplayCode=09')
})

test('the page is read from its preloaded state; a page with no product is null', () => {
  assert.equal(sweater.name, '3D KNIT Crew Neck Sweater')
  assert.equal(sweater.colors.length, 5)
  assert.equal(readUniqloPage(page('uniqlo-not-found.html')), null)
  assert.throws(() => readUniqloPage('<html><body>Access denied</body></html>'), UniqloPageError)
})

test('a link that names no colour picks the only one, or says which there are', () => {
  assert.deepEqual(chooseColour(sweater, '69'), { colour: '69' })
  assert.deepEqual(chooseColour(sweater, null), { missing: 'unnamed', choices: ['Grey', 'Black', 'Natural', 'Green', 'Navy'] })
  assert.deepEqual(chooseColour(sweater, '99'), { missing: 'gone', choices: ['Grey', 'Black', 'Natural', 'Green', 'Navy'] })
  assert.deepEqual(chooseColour({ ...sweater, colors: [sweater.colors[1]!] }, null), { colour: '09' })
})

test('colour names read as the other shops write them, in NZ spelling', () => {
  assert.equal(colourName('OFF WHITE'), 'Off White')
  assert.equal(colourName('DARK GRAY'), 'Dark Grey')
})

test('one colour is one product: its photo, its sizes, the sale price beside the usual one', () => {
  const black = normaliseUniqlo(sweater, '09', store)
  assert.equal(black.external_id, 'E475296-000-00-09')
  assert.equal(black.handle, 'E475296-000/00/09')
  assert.equal(black.url, 'https://www.uniqlo.com/au/en/products/E475296-000/00?colorDisplayCode=09')
  assert.deepEqual([black.vendor, black.product_type, black.garment_type, black.menswear], ['Uniqlo', 'Jumpers & Sweaters', 'knitwear', true])
  assert.equal(black.images[0]!.src, 'https://image.uniqlo.com/UQ/ST3/au/imagesgoods/475296/item/augoods_09_475296_3x4.jpg')
  assert.ok(
    black.images.every((image) => image.src.includes('_09_') || !/goods_\d\d_/.test(image.src)),
    'no photo of another colour',
  )
  assert.deepEqual([...new Set(black.variants.map((variant) => variant.option_colour))], ['Black'])
  assert.deepEqual(black.variants.map((variant) => variant.size_key), ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'])
  const medium = black.variants.find((variant) => variant.option_size === 'M')!
  assert.deepEqual([medium.price_cents, medium.compare_at_cents, medium.available], [490, 5990, true])
  assert.match(black.body_html ?? '', /Fabric: 60% Acrylic, 40% Cotton/)

  const navy = normaliseUniqlo(sweater, '69', store)
  assert.notEqual(navy.external_id, black.external_id, 'each colour is its own product')
  assert.notEqual(navy.content_hash, black.content_hash)
  assert.throws(() => normaliseUniqlo(sweater, '99', store), UniqloPageError)
})

test('a video among the photos is left out, not read as a broken page', () => {
  // uniqlo.com/us/en on 2026-11-05: a tee whose extra shots include { video: "...mp4" } with no image.
  const tee = readUniqloPage(page('uniqlo-us-tee.html'))!
  assert.equal(tee.name, 'SUPIMA® Cotton T-Shirt')
  const white = normaliseUniqlo(tee, '00', { base_url: 'https://www.uniqlo.com/us/en' })
  assert.equal(white.images[0]!.src, 'https://image.uniqlo.com/UQ/ST3/us/imagesgoods/455365/item/usgoods_00_455365_3x4.jpg')
  assert.ok(white.images.every((image) => image.src.endsWith('.jpg')))
  assert.equal(white.variants[0]!.price_cents, 2490)
})

test('jeans are sized by waist and at full price have nothing to compare against', () => {
  const blue = normaliseUniqlo(jeans, '66', store)
  assert.equal(blue.garment_type, 'jeans')
  assert.equal(blue.menswear, true, 'unisex counts')
  assert.equal(blue.variants[0]!.size_key, 'W28')
  assert.equal(blue.variants[0]!.compare_at_cents, null)
  assert.equal(blue.variants[0]!.price_cents, 5990)
})
