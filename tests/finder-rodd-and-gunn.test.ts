import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { colourName, familiesIn } from '../src/lib/finder/colour.ts'
import {
  leadId,
  normaliseRoddAndGunn,
  readRoddAndGunnPage,
  roddAndGunnId,
  RoddAndGunnPageError,
  RoddAndGunnStylePage,
} from '../src/lib/finder/rodd-and-gunn.ts'

/*
 * Rodd & Gunn's product pages, saved from roddandgunn.com/nz on 2026-11-05
 * and trimmed to the parts the adapter reads (tests/fixtures/rodd-and-gunn-*):
 * an oxford shirt with most sizes sold out, an outlet shirt on sale, a coat
 * read from one of its size pages, a cap sold in one size, a chino in its
 * three leg lengths, and the page for a style with no colour chosen.
 */
const page = (name: string) => readFileSync(new URL(`./fixtures/rodd-and-gunn-${name}.html`, import.meta.url), 'utf8')
const read = (name: string) => readRoddAndGunnPage(page(name))

test('a link gives its colour, from a colour page, a size page or another region', () => {
  const id = (link: string) => roddAndGunnId(new URL(link))
  assert.equal(id('https://www.roddandgunn.com/nz/clothing/shirts/oxford-shirt/006582-12.html'), '006582-12')
  assert.equal(id('https://www.roddandgunn.com/nz/outlet/shirts/denniston-sports-fit-shirt-%C2%B7-bluejay-xxl/009966-01-XXL.html'), '009966-01')
  assert.equal(id('https://www.roddandgunn.com/au/clothing/polos/the-gunn-polo-%C2%B7-sage-me/003396-111-ME.html?x=1'), '003396-111')
  assert.equal(id('https://www.roddandgunn.com/nz/clothing/pants/thomas-road-chino-pant--%C2%B7-coal-44/006171-19-44.html'), '006171-19')
  assert.equal(id('https://www.roddandgunn.com/nz/clothing/shirts/oxford-shirt/006582.html'), '006582', 'a style, no colour')
  assert.equal(id('https://www.roddandgunn.com/nz/clothing/shirts'), null)
})

test('a colour page gives its words, price, photos and stock per size', () => {
  const oxford = read('oxford')
  assert.equal(oxford.id, '006582-12')
  assert.equal(oxford.name, 'Oxford Shirt')
  assert.equal(oxford.url, 'https://www.roddandgunn.com/nz/clothing/shirts/oxford-shirt/006582-12.html')
  assert.deepEqual([oxford.currency, oxford.price, oxford.was, oxford.inStock], ['NZD', 139, null, true])
  assert.deepEqual([oxford.category, oxford.crumbs, oxford.colour], ['Clothing', ['Clothing', 'Shirts'], 'POWDER BLUE'])
  assert.equal(oxford.images.length, 5)
  assert.ok(oxford.images.every((src) => src.includes('/dw/image/v2/bbrs_prd/on/demandware.static/') && src.includes('POWDER-BLUE')))
  assert.deepEqual(
    oxford.sizes.map((size) => `${size.label}${size.available ? '' : ' out'}`),
    ['XS out', 'SM out', 'ME out', 'LG out', 'XL out', 'XXL', 'XXXL'],
  )
  assert.match(oxford.notes[1]!, /^100% Australian Good Earth Cotton/)
  assert.ok(oxford.notes[1]!.includes('FibreTrace®'), 'entities read')
})

test('an outlet piece has its usual price beside the sale price', () => {
  const shirt = read('outlet-shirt')
  assert.deepEqual([shirt.price, shirt.was, shirt.category], [99, 159, 'Outlet'])
  const product = normaliseRoddAndGunn([shirt])
  assert.deepEqual([product.variants[0]!.price_cents, product.variants[0]!.compare_at_cents], [9900, 15900])
})

test('a size page reads as its colour: the name without the size, the canonical link, every size', () => {
  const coat = read('coat-size')
  assert.equal(coat.id, '009989-01')
  assert.equal(coat.name, 'Guards Bay Coat')
  assert.equal(coat.url, 'https://www.roddandgunn.com/nz/best-sellers/jackets-coats/guards-bay-coat/009989-01.html')
  assert.equal(coat.sizes.length, 7)
  assert.equal(coat.images.length, 6)
})

test('a style page names no colour, and says which there are', () => {
  assert.throws(
    () => read('style'),
    (error: unknown) => {
      assert.ok(error instanceof RoddAndGunnStylePage)
      assert.equal(error.colours.length, 14)
      assert.deepEqual(error.colours[0], { name: 'Army', url: '/nz/clothing/shirts/oxford-shirt/006582-24.html' })
      return true
    },
  )
  assert.throws(() => readRoddAndGunnPage('<html><body>Access denied</body></html>'), RoddAndGunnPageError)
})

test('one colour is one product, in the words and sizes the other shops use', () => {
  const oxford = normaliseRoddAndGunn([read('oxford')])
  assert.deepEqual([oxford.external_id, oxford.handle, oxford.vendor], ['006582-12', '006582-12', 'Rodd & Gunn'])
  assert.deepEqual([oxford.product_type, oxford.garment_type, oxford.menswear], ['Shirts', 'shirt', true])
  assert.deepEqual(
    oxford.variants.map((variant) => [variant.external_id, variant.option_size, variant.size_key, variant.available]),
    [
      ['006582-12-XS', 'XS', 'XS', false],
      ['006582-12-SM', 'S', 'S', false],
      ['006582-12-ME', 'M', 'M', false],
      ['006582-12-LG', 'L', 'L', false],
      ['006582-12-XL', 'XL', 'XL', false],
      ['006582-12-XXL', 'XXL', 'XXL', true],
      ['006582-12-XXXL', 'XXXL', 'XXXL', true],
    ],
  )
  assert.equal(oxford.variants[0]!.option_colour, 'Powder Blue')
  assert.equal(oxford.images[0]!.alt, 'Oxford Shirt, Powder Blue')
  assert.match(oxford.body_html!, /^<p>The oxford button-down shirt.*<\/p><ul><li>Sports Fit - Fitted/)

  const cap = normaliseRoddAndGunn([read('cap')])
  assert.deepEqual([cap.garment_type, cap.garment_kind, cap.product_type], ['accessory', 'cap', 'Hats'])
  assert.deepEqual(cap.variants.map((variant) => [variant.external_id, variant.option_size, variant.size_key]), [['004492-38-ONE', 'One size', 'ONE']])
})

test('a coat under "Jackets & Coats" is a coat by its breadcrumb, and a jacket there is left to its title', () => {
  const coat = normaliseRoddAndGunn([read('coat-size')])
  assert.deepEqual([coat.product_type, coat.garment_type], ['Coats', 'coat'])
  const jacket = normaliseRoddAndGunn([
    { ...read('coat-size'), name: 'The Cascades Sports Fit Jacket', crumbs: ['Clothing', 'Jackets & Coats'], type: 'Jackets & Coats' },
  ])
  assert.deepEqual([jacket.product_type, jacket.garment_type], [null, 'jacket'])
  const slide = normaliseRoddAndGunn([{ ...read('cap'), name: 'Raglan Slide', crumbs: ['Footwear', 'Sandals'], type: 'Gifts Under $200' }])
  assert.deepEqual([slide.product_type, slide.garment_type], ['Sandals', 'shoes'])
})

test('a chino in three leg lengths is one product under its Regular id, each size named with its length', () => {
  const [short, regular, long] = [read('chino-short'), read('chino-regular'), read('chino-long')]
  assert.deepEqual(
    regular.lengths.map((length) => [length.label, length.id]),
    [
      ['SHORT', '006171-20'],
      ['REGULAR', '006171-19'],
      ['LONG', '006171-21'],
    ],
  )
  assert.equal(leadId(short), '006171-19', 'whichever length was read first')
  const chino = normaliseRoddAndGunn([long, short, regular])
  assert.deepEqual([chino.external_id, chino.url], ['006171-19', regular.url])
  assert.equal(chino.garment_type, 'trousers')
  assert.equal(chino.variants.length, 33)
  assert.deepEqual(
    chino.variants.slice(0, 4).map((variant) => variant.title),
    ['Coal / 28 / Short', 'Coal / 28 / Regular', 'Coal / 28 / Long', 'Coal / 30 / Short'],
    'by size, then length, so the sizes in stock read in order',
  )
  const inStock = chino.variants.filter((variant) => variant.available).map((variant) => variant.title)
  assert.deepEqual(inStock, [
    'Coal / 28 / Long',
    'Coal / 42 / Short',
    'Coal / 42 / Long',
    'Coal / 44 / Short',
    'Coal / 44 / Regular',
    'Coal / 44 / Long',
  ])
  assert.ok(chino.variants.every((variant) => variant.size_key === `W${variant.option_size}`))
  assert.equal(normaliseRoddAndGunn([regular, short, long]).content_hash, chino.content_hash, 'read in any order')
})

test('the shop’s colour names read as the others write them, and its own words settle a family', () => {
  assert.equal(colourName('DK GREEN'), 'Dark Green')
  assert.equal(colourName('LT  BLUE'), 'Light Blue')
  assert.equal(colourName('POWDER BLUE'), 'Powder Blue')
  assert.deepEqual(familiesIn('Nero'), ['black'])
  assert.deepEqual(familiesIn('Obsidian'), ['black'])
  assert.deepEqual(familiesIn('Spearmint'), ['green'])
  assert.deepEqual(familiesIn('Garnet'), ['red'])
  assert.deepEqual(familiesIn('Eclipse'), [], 'a name that could be navy or black is left to the photo')
})
