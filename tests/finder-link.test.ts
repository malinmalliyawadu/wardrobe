import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { fromProductJs, parseProductLink, ProductLinkError, retailerForHost } from '../src/lib/finder/product-link.ts'
import { normaliseProduct } from '../src/lib/finder/shopify.ts'

/* A Country Road product's /products/<handle>.js, saved on 2026-11-04. */
const fixture = JSON.parse(readFileSync(new URL('./fixtures/shopify-product.js.json', import.meta.url), 'utf8'))

test('a product link gives its host and handle, however it was copied', () => {
  assert.deepEqual(parseProductLink('https://www.countryroad.co.nz/products/cot-strap-knit-shirt-60321701'), {
    host: 'countryroad.co.nz',
    handle: 'cot-strap-knit-shirt-60321701',
  })
  assert.deepEqual(
    parseProductLink(' https://www.countryroad.co.nz/en-nz/collections/man/products/Cot-Strap-Knit-Shirt-60321701?variant=4878 '),
    { host: 'countryroad.co.nz', handle: 'cot-strap-knit-shirt-60321701' },
  )
  assert.equal(parseProductLink('https://crane-brothers.com/products/lightweight-cotton-polo-onyx/').handle, 'lightweight-cotton-polo-onyx')
  assert.throws(() => parseProductLink('countryroad.co.nz/products/x'), ProductLinkError, 'no scheme is not a link')
  assert.throws(() => parseProductLink('https://www.countryroad.co.nz/collections/man'), /not a product page/)
  assert.throws(() => parseProductLink('ftp://example.com/products/x'), ProductLinkError)
})

test('a link belongs to the store whose site or feed host it is on', () => {
  const stores = [
    { slug: 'country-road', base_url: 'https://www.countryroad.co.nz', feed_url: null },
    { slug: 'crane-brothers', base_url: 'https://crane-brothers.com', feed_url: 'https://crane-brothers-nz.myshopify.com' },
  ]
  assert.equal(retailerForHost(stores, 'countryroad.co.nz')?.slug, 'country-road', 'with or without www')
  assert.equal(retailerForHost(stores, 'crane-brothers-nz.myshopify.com')?.slug, 'crane-brothers')
  assert.equal(retailerForHost(stores, 'asos.com'), null)
})

test('the per-product endpoint reads as a products.json product: cents to dollars, images with a scheme', () => {
  const product = fromProductJs(fixture)
  assert.equal(product.title, 'Cot Strap Knit Shirt')
  assert.equal(product.product_type, 'Knit - Urban')
  assert.equal(product.images[0]!.src.startsWith('https://cdn.shopify.com/'), true)
  const small = product.variants.find((variant) => variant.option2 === 'Small')!
  assert.equal(small.price, '179.00')
  assert.equal(small.available, true)

  const stored = normaliseProduct(product, { base_url: 'https://www.countryroad.co.nz', catalogue: 'menswear' })
  assert.equal(stored.url, 'https://www.countryroad.co.nz/products/cot-strap-knit-shirt-60321701')
  assert.equal(stored.garment_type, 'knitwear', 'a knit shirt is a knit')
  const s = stored.variants.find((variant) => variant.option_size === 'Small')!
  assert.deepEqual([s.price_cents, s.option_colour, s.size_key], [17900, 'Stone', 'S'])
  assert.equal(stored.variants.find((variant) => variant.option_size === 'XX-Large')?.available, false)
})
