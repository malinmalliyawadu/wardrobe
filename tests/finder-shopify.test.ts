import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  contentHash,
  normaliseProduct,
  ShopifyPageSchema,
  ShopifyProductSchema,
  type NormalisedProduct,
} from '../src/lib/finder/shopify.ts'

/*
 * The adapter against a real page: products saved from Huffer's men's
 * collection, Barkers and END. on 2026-11-04, trimmed to the cases that
 * matter (colour and size options, a sale, a one-size product, END.'s
 * zero-price placeholders, its "XLarge" labels).
 */

const page = ShopifyPageSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/shopify-page.json', import.meta.url), 'utf8')))
const raws = page.products.map((raw) => ShopifyProductSchema.parse(raw))

function normalised(title: string, catalogue: 'menswear' | 'mixed' = 'menswear'): NormalisedProduct {
  const raw = raws.find((product) => product.title.startsWith(title))
  assert.ok(raw, `fixture has ${title}`)
  return normaliseProduct(raw, { base_url: 'https://shop.test', catalogue })
}

test('every product on the saved page parses and normalises', () => {
  assert.equal(raws.length, 6)
  for (const raw of raws) {
    const product = normaliseProduct(raw, { base_url: 'https://shop.test', catalogue: 'menswear' })
    assert.match(product.content_hash, /^[0-9a-f]{32}$/)
    assert.equal(product.url, `https://shop.test/products/${raw.handle}`)
    assert.equal(product.variants.length, raw.variants.length)
  }
})

test('colour and size come from the options they are named for, prices in cents', () => {
  const tee = normalised('NIGHT CAMO BOX TEE')
  assert.equal(tee.external_id, '9634913648808')
  assert.equal(tee.garment_type, 'tee')
  assert.equal(tee.menswear, true)
  const small = tee.variants.find((variant) => variant.option_size === 'S')!
  assert.equal(small.option_colour, 'BLACK')
  assert.equal(small.price_cents, 8999)
  assert.equal(small.size_key, 'S')
  assert.equal(small.available, false, 'S is sold out on the saved page')
  assert.equal(tee.variants.find((variant) => variant.option_size === 'XS')?.available, true)
})

test('a compare-at price only counts when it is above the price', () => {
  const shirt = normalised('Keegan Check Business Shirt')
  assert.equal(shirt.garment_type, 'shirt')
  assert.ok(shirt.variants.every((variant) => variant.price_cents === 12999 && variant.compare_at_cents === null))
  const towel = normalised('Barkers Beach Towel')
  assert.equal(towel.variants[0]!.compare_at_cents, 7999, 'a real markdown keeps its full price')
  assert.equal(towel.variants[0]!.size_key, 'ONE', 'OSF is one size')
  assert.equal(towel.garment_type, null, 'a towel is never a slot')
})

test('END. zero prices are placeholders, not free, and its "XLarge" is XL', () => {
  const tee = normalised('PICANTE Peaks Patch T-Shirt', 'mixed')
  assert.equal(tee.menswear, true, 'gender:Mens tag')
  assert.equal(tee.garment_type, 'tee')
  assert.ok(tee.variants.every((variant) => variant.price_cents === 0 && !variant.available))
  assert.deepEqual(
    tee.variants.map((variant) => variant.size_key),
    tee.variants.map((variant) => ({ XLarge: 'XL', Large: 'L', Medium: 'M', Small: 'S' })[variant.option_size!]),
  )
})

test('the content hash follows what the scorer sees, not price or stock', () => {
  const raw = raws.find((product) => product.title.startsWith('STRIPE SS TEE'))!
  const base = normaliseProduct(raw, { base_url: 'https://shop.test', catalogue: 'menswear' }).content_hash
  const repriced = {
    ...raw,
    variants: raw.variants.map((variant) => ({ ...variant, price: '19.99', compare_at_price: '79.99', available: false })),
  }
  assert.equal(normaliseProduct(repriced, { base_url: 'https://shop.test', catalogue: 'menswear' }).content_hash, base)

  const reuploaded = { ...raw, images: raw.images.map((image) => ({ ...image, src: `${image.src.split('?')[0]}?v=999` })) }
  assert.equal(normaliseProduct(reuploaded, { base_url: 'https://shop.test', catalogue: 'menswear' }).content_hash, base, 'the ?v= cache-buster is ignored')

  const retitled = { ...raw, title: `${raw.title} RELAXED` }
  assert.notEqual(normaliseProduct(retitled, { base_url: 'https://shop.test', catalogue: 'menswear' }).content_hash, base)
  const rephotographed = { ...raw, images: [{ ...raw.images[0]!, src: 'https://cdn.shopify.com/s/files/new.jpg' }] }
  assert.notEqual(normaliseProduct(rephotographed, { base_url: 'https://shop.test', catalogue: 'menswear' }).content_hash, base)
})

test('the hash is stable however the store orders tags or colours', () => {
  const material = {
    title: 'Tee',
    vendor: null,
    productType: 'Tee',
    bodyHtml: null,
    images: [],
  }
  assert.equal(
    contentHash({ ...material, tags: ['a', 'b'], variants: [{ option_colour: 'Navy' }, { option_colour: 'Black' }] }),
    contentHash({ ...material, tags: ['a', 'b'], variants: [{ option_colour: 'Black' }, { option_colour: 'Navy' }, { option_colour: 'Navy' }] }),
  )
})

test('a product with no size option is one size; tags given as a string are split', () => {
  const raw = ShopifyProductSchema.parse({
    id: 1,
    title: 'Leather Belt - Espresso',
    handle: 'belt',
    product_type: 'Belts',
    tags: 'Mens, Leather ,Mens',
    options: [{ name: 'Colour', position: 1, values: ['Espresso'] }],
    variants: [{ id: 2, option1: 'Espresso', price: '99.00', available: true }],
    images: [],
  })
  const belt = normaliseProduct(raw, { base_url: 'https://shop.test', catalogue: 'mixed' })
  assert.deepEqual(belt.tags, ['Leather', 'Mens'])
  assert.equal(belt.garment_type, 'belt')
  assert.equal(belt.garment_kind, null)
  assert.equal(belt.variants[0]!.option_size, 'One size')
  assert.equal(belt.variants[0]!.size_key, 'ONE')
  assert.equal(belt.variants[0]!.option_colour, 'Espresso')
})

test('a size option the store did not call "Size" is still found', () => {
  const raw = ShopifyProductSchema.parse({
    id: 1,
    title: 'Chino',
    handle: 'chino',
    product_type: 'Pants',
    options: [{ name: 'Title', position: 1, values: ['30', '32', '34'] }],
    variants: [{ id: 2, option1: '32', price: '160.00', available: true }],
  })
  const chino = normaliseProduct(raw, { base_url: 'https://shop.test', catalogue: 'menswear' })
  assert.equal(chino.variants[0]!.option_size, '32')
  assert.equal(chino.variants[0]!.size_key, 'W32')
})
