import assert from 'node:assert/strict'
import { test } from 'node:test'

import sharp from 'sharp'

import { categoryText, garmentOf, isMenswear, kitGarmentOf, sizeKey, slotKind, wantedSizeKeys } from '../src/lib/finder/classify.ts'
import { colourCompatible, cutCompatible, familiesIn, namedCut, productFamilies, slotFamilies } from '../src/lib/finder/colour.ts'
import { readPhoto } from '../src/lib/finder/photo-colour.ts'

/* Cases taken from the eleven stores' real listings on 2026-11-04. */

test('garment types from real titles and product types', () => {
  const cases: [string, string | null, string | null, string?][] = [
    ['NIGHT CAMO BOX TEE 220 BLACK', 'HUFFER BY HUFFER', 'tee'],
    ['HFR TANK 190/BILLED WHITE', 'HUFFER BY HUFFER', 'tank'],
    ['Merino Singlet', null, 'tank'],
    ['Australian Cotton Crew Sweat', 'Sweat - Casual', 'sweatshirt'],
    ['Sweat Short', 'Shorts', 'shorts'],
    ['Merino Crew', 'Knitwear', 'knitwear'],
    ['Aubergine Merino Knitted Polo', null, 'polo'],
    ['Wool Overshirt', 'Shirts', 'overshirt'],
    ['Classic Oxford Shirt', 'Shirts', 'shirt'],
    ['Suit Trouser', 'Tailoring', 'trousers'],
    ['Unstructured Blazer', null, 'tailoring'],
    ['Loud Larry - Dry Selvage', 'Mens Denim', 'jeans'],
    ['Denim Jacket', null, 'jacket'],
    ['Suede Chelsea Boot', 'Footwear', 'boots'],
    ['Axel Arigato Daze Runner', null, 'sneakers'],
    ['Leather Penny Loafer', 'Footwear', 'shoes'],
    ['Waxed Canvas Backpack', null, 'bag'],
    ['Umbro Panelled Long Sleeve Jersey', null, 'tee'],
    ['CLASSIC HOOD / BASIS BLACK', 'CLUBHOUSE CLASSICS', 'sweatshirt'],
    ['Merino Watch Cap', null, 'accessory', 'beanie'],
    ['Logo Cap', 'Caps', 'accessory', 'cap'],
    ['Leather Belt', null, 'belt'],
    ["Men's Down Sweater™", 'Medium,Tops', 'jacket'],
    ["Men's Micro Puff® Hoody", 'Medium,Tops', 'jacket'],
    ["Men's Better Sweater® 1/4-Zip", 'Fleece', 'sweatshirt'],
    ["Men's Twill Traveler 5-Pocket Pants - Regular", 'Medium,Bottoms & One Pieces', 'trousers'],
    ['Short Sleeve Seersucker Cuban Shirt', 'Shirts', 'shirt'],
    ['Jackson Fitted Short Sleeve Henley Ivory', 'Mens Tees', 'tee'],
    ["Men's Short-Sleeved Self-Guided Sun Shirt", 'Medium,Tops', 'shirt'],
    ['Christian Kimber Otway Short-Sleeved Polo - Sky Stripe', null, 'polo'],
    ['Linen Short', 'Mens Shorts', 'shorts'],
    ['Cassius Knitted Vest Khaki', 'Mens Jackets', 'knitwear'],
    ['CABLE KNIT VEST NAVY', null, 'knitwear'],
    ['Oliver Spencer V Neck Knit Vest', null, 'knitwear'],
    ['Patagonia Down Sweater Vest', null, 'jacket'],
  ]
  for (const [title, type, garment, kind] of cases) {
    const result = garmentOf(title, type)
    assert.equal(result.garment_type, garment, title)
    if (kind) assert.equal(result.garment_kind, kind, title)
  }
})

test('never a slot: swimwear, socks, jewellery, sunglasses, towels', () => {
  for (const [title, type] of [
    ['Geo Swim Short', 'Short - Casual'],
    ['Marcoliani Luxury Stripe Socks', 'Footwear'],
    ['Serge DeNimes Onyx Armour Ring', 'Rings'],
    ['Port Tanger Ayreen Sunglasses', null],
    ['Barkers Beach Towel', 'Accessories / General Accessories'],
    ['Ring Spun Tee', 'Rings'],
    ["Men's R1® Yulex® Regulator® Front-Zip Spring Suit", 'Wetsuits'],
    ['R3® Yulex® Regulator® Split Toe Wetsuit Booties', null],
    ["Men's RØ® Top", 'Tops - L/S,L/S Pullovers / Swimwear'],
    ['Merino Rib Vest', 'Underwear'],
    ['Ribbed Vest White', null],
  ] as const) {
    assert.equal(garmentOf(title, type).garment_type, null, title)
  }
  assert.equal(garmentOf('Ring Spun Tee', 'T-Shirts').garment_type, 'tee', '"ring" in a title is not jewellery')
})

test('sport kit is activewear, so it never fills a style slot', () => {
  assert.equal(garmentOf('Brooks Adrenaline GTS 4', 'Running Shoes').garment_type, 'activewear')
  assert.equal(garmentOf('Restrained Active Crop Tee - Off White', 'activewear').garment_type, 'activewear')
  assert.equal(garmentOf('Huffer Golf Polo', 'HUFFER GOLF').garment_type, 'activewear')
  assert.equal(garmentOf("Men's Insulated Snowfarer Bibs", 'Medium,Bottoms & One Pieces').garment_type, 'activewear')
  assert.equal(garmentOf("Men's Swiftcurrent Wading Pants", null).garment_type, 'activewear')
  assert.equal(garmentOf("Men's Capilene® Cool Daily Shirt", 'Tops - S/S').garment_type, 'activewear', 'Capilene is a technical fabric')
  assert.equal(garmentOf('Bib-Front Lansdowne Dinner Shirt - White', 'Shirts').garment_type, 'shirt', 'a bib front is not cycling bibs')
  assert.equal(garmentOf('Axel Arigato Daze Runner', null).garment_type, 'sneakers', 'a lifestyle runner is a sneaker')
})

test('as a piece he owns, sport kit is the garment it is', () => {
  assert.equal(kitGarmentOf('Brooks Adrenaline GTS 4', 'Running Shoes'), 'shoes')
  assert.equal(kitGarmentOf('Restrained Active Crop Tee - Off White', 'activewear'), 'tee')
  assert.equal(kitGarmentOf('Training Singlet', null), 'tank')
  assert.equal(kitGarmentOf('Compression Leggings', null), null, 'still not menswear the app dresses')
})

test("END.'s empty product type is read from its category tags", () => {
  const type = categoryText(null, ['cat_high:Apparel', 'cat_low:Sweatshirts', 'cat_med:Tops', 'gender:Mens'])
  assert.equal(garmentOf('Umbro Diamond Drill Top', type).garment_type, 'sweatshirt')
})

test('menswear: a menswear store needs only not to say women or kids; a mixed store must say men', () => {
  const base = { title: 'Box Tee', productType: 'Tops', tags: [] as string[] }
  assert.ok(isMenswear({ ...base, catalogue: 'menswear' }))
  assert.ok(!isMenswear({ ...base, title: 'WOMENS FINE RIB TANK', catalogue: 'menswear' }))
  assert.ok(!isMenswear({ ...base, catalogue: 'mixed' }))
  assert.ok(isMenswear({ ...base, tags: ['Mens'], catalogue: 'mixed' }))
  assert.ok(isMenswear({ ...base, tags: ['Gender:Unisex'], catalogue: 'mixed' }))
  assert.ok(!isMenswear({ ...base, tags: ['Gender:Women'], catalogue: 'mixed' }))
  assert.ok(isMenswear({ ...base, tags: ['Woman Man Nov 2026'], catalogue: 'mixed' }), 'says men as well as women')
  assert.ok(!isMenswear({ ...base, tags: ['Child Boys', 'Mens'], catalogue: 'mixed' }), 'kids never')
  assert.ok(
    !isMenswear({ ...base, productType: 'Womens Pants', tags: ['Mens', 'Mens: Pants'], catalogue: 'mixed' }),
    "a women's product type outweighs a loose men tag",
  )
  assert.ok(
    isMenswear({ ...base, productType: 'Womens Denim', tags: ['Gender:Men', 'Gender:Women'], catalogue: 'mixed' }),
    'but not a gender tag',
  )
})

test('size keys by garment', () => {
  assert.equal(sizeKey('Small', 'tee'), 'S')
  assert.equal(sizeKey('S/M', 'tee'), 'S/M')
  assert.equal(sizeKey('IT 46', 'jacket'), 'C46')
  assert.equal(sizeKey('46', 'tailoring'), 'C46')
  assert.equal(sizeKey('38R', 'tailoring'), 'R38')
  assert.equal(sizeKey('32', 'trousers'), 'W32')
  assert.equal(sizeKey('30/32', 'jeans'), 'W30')
  assert.equal(sizeKey('W31 L32', 'jeans'), 'W31')
  assert.equal(sizeKey('42', 'sneakers'), 'EU42')
  assert.equal(sizeKey('UK 8.5', 'boots'), 'UK8.5')
  assert.equal(sizeKey('US9', 'shoes'), 'US9')
  assert.equal(sizeKey('O/S', 'accessory'), 'ONE')
  assert.equal(sizeKey('Default Title', null), 'ONE')
  assert.equal(sizeKey('34"', 'jeans'), 'W34')
  assert.equal(sizeKey('30 inch Waist x 32 inch Leg', 'jeans'), 'W30')
  assert.equal(sizeKey('32"', 'belt'), 'W32', 'a belt is sized by the waist')
  assert.equal(sizeKey('2 (S)', 'knitwear'), 'S')
  assert.equal(sizeKey('XXXX LARGE', 'tee'), null)
  assert.equal(sizeKey('OSA', 'bag'), 'ONE')
  assert.equal(sizeKey('ALL', 'accessory'), 'ONE', "Patagonia's hats")
  assert.equal(sizeKey('8', 'sneakers'), null, 'a bare 8 on a shoe could be UK or US')
  assert.equal(sizeKey('Ocean', 'tee'), null)
})

test('his sizes: the tee size covers neighbouring pairs and chest numbers; unknown sizes are null', () => {
  const tops = wantedSizeKeys('knitwear', [], { tee: 'S' })
  assert.deepEqual(tops, ['S', 'S/XS', 'XS/S', 'S/M', 'M/S', 'C46', 'R36', 'R38'])
  assert.equal(wantedSizeKeys('trousers', [], { tee: 'S' }), null)
  assert.deepEqual(wantedSizeKeys('trousers', [], { waist_cm: 79 }), ['W31'])
  assert.deepEqual(wantedSizeKeys('sneakers', [], { shoe_eu: 42, shoe_uk: 8 }), ['EU42', 'UK8'])
  assert.deepEqual(wantedSizeKeys('tee', ['M'], { tee: 'S' })?.[0], 'M', "a slot's own labels win")
  assert.equal(wantedSizeKeys('accessory', [], { tee: 'S' }), null)
})

test('accessory slots name their kind', () => {
  assert.equal(slotKind('accessory', 'Espresso fine merino beanie'), 'beanie')
  assert.equal(slotKind('accessory', 'Ink merino scarf'), 'scarf')
  assert.equal(slotKind('belt', 'Espresso leather belt with antique brass buckle'), null, 'a belt is its own type')
  assert.equal(slotKind('accessory', 'Brushed gold cream-dial watch on dark brown leather strap'), 'watch')
  assert.equal(slotKind('knitwear', 'Pine fine-gauge merino crewneck'), null)
})

test('colour words, longest phrase first', () => {
  assert.deepEqual(familiesIn('Heavy Box Tee - Off White'), ['ecru'])
  assert.deepEqual(familiesIn('STRIPE SS TEE BAY BLUE/CHALK').sort(), ['blue', 'ecru'])
  assert.deepEqual(familiesIn('Coat'), [], '"oat" inside a word is not a colour')
  assert.deepEqual(familiesIn('Tank Top'), [], '"tan" inside a word is not a colour')
  assert.deepEqual(familiesIn('Stone Wash Jean'), ['blue'])
})

test('the brand is not the colour', () => {
  assert.deepEqual(productFamilies({ title: 'Stone Island Ghost Overshirt', vendor: 'Stone Island', colours: [], tags: [] }), [])
  assert.deepEqual(productFamilies({ title: 'Tee', vendor: null, colours: ['Pine', 'Black'], tags: [] }).sort(), ['black', 'green'])
  assert.deepEqual(productFamilies({ title: 'Tee', vendor: null, colours: [], tags: ['Colour:Silver', 'Gender:Men'] }), ['grey'])
})

test('the colour rule only says no when the words are sure', () => {
  const ecru = slotFamilies(['Ecru heavyweight cotton crew tee', 'ecru'])
  assert.deepEqual(ecru?.sort(), ['beige', 'ecru'])
  assert.ok(!colourCompatible(ecru, ['black']))
  assert.ok(colourCompatible(ecru, ['black', 'ecru']), 'one of its colours is enough')
  assert.ok(colourCompatible(ecru, []), 'no colour words: Claude decides')
  assert.ok(colourCompatible(null, ['black']), 'a slot with no colour words takes anything')
  const watch = slotFamilies(['Brushed gold cream-dial watch on dark brown leather strap', 'cream and dark brown'])
  assert.ok(colourCompatible(watch, ['yellow']), 'gold is in the slot name')
})

test('a cut the listing names about itself, against what the slot and guide allow', () => {
  assert.equal(namedCut('Heavy Box Tee 2.0 - Off White'), 'oversized')
  assert.equal(namedCut('Wide Tee Black | Boxy | Oversized'), 'oversized')
  assert.equal(namedCut('Relaxed Fit Chino'), 'relaxed')
  assert.equal(namedCut('Ecru Heavyweight Crew Tee'), null)
  assert.ok(!cutCompatible(['slim', 'regular'], 'oversized'))
  assert.ok(cutCompatible(['regular', 'relaxed'], 'relaxed'))
  assert.ok(cutCompatible(['slim'], null), 'a listing that names no cut stays for Claude')
  assert.ok(cutCompatible(null, 'oversized'), 'a slot with no fit and no guide entry takes any cut')
})

async function photo(garment: string, background = '#ffffff'): Promise<Buffer> {
  const square = await sharp({ create: { width: 120, height: 150, channels: 3, background: garment } }).png().toBuffer()
  return sharp({ create: { width: 200, height: 250, channels: 3, background } })
    .composite([{ input: square, left: 40, top: 50 }])
    .jpeg()
    .toBuffer()
}

test('a photo read finds the garment against its background', async () => {
  assert.ok((await readPhoto(await photo('#2b3a5c'))).families.includes('navy'))
  assert.deepEqual((await readPhoto(await photo('#7a1f24', '#f2f2f2'))).families, ['red'])
  assert.ok((await readPhoto(await photo('#2f4a3a'))).families.includes('green'))
  const pale = await readPhoto(await photo('#c9c9c9'))
  assert.ok(pale.families.includes('white'), 'a pale grey read may be a shaded white')
  assert.ok(!pale.families.includes('ecru'), 'but with no warmth in it, not cream')
  const cream = await readPhoto(await photo('#d8cfba'))
  assert.ok(cream.families.includes('ecru'), 'a shaded cream keeps its warmth')
  assert.equal(cream.colours.length >= 1, true, 'the read stores the colour itself, as hex')
  const lost = await readPhoto(await photo('#fbfbfb'))
  assert.deepEqual(lost.families, [], 'white on white is unsure, so the product stays')
})
