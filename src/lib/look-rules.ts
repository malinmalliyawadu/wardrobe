import type { GarmentType } from './wardrobe-values.ts'

/*
 * What makes a set of pieces one whole outfit, by garment alone. Held by
 * tidyLooks on everything Claude puts together, and by the look cards when
 * he changes a look's pieces, so it lives apart from the database code and
 * can run in the browser.
 */

/** Outermost layer first, then down the body, then what is carried. A look's pieces are shown in this order. */
export const LAYER_ORDER: GarmentType[] = [
  'coat', 'jacket', 'tailoring', 'overshirt', 'knitwear', 'sweatshirt', 'shirt', 'polo', 'tee', 'tank',
  'activewear', 'trousers', 'jeans', 'shorts', 'belt', 'boots', 'shoes', 'sneakers', 'accessory', 'bag',
]

export const TOPS: GarmentType[] = ['tee', 'tank', 'polo', 'shirt', 'knitwear', 'sweatshirt', 'overshirt']
export const BOTTOMS: GarmentType[] = ['trousers', 'jeans', 'shorts']
export const FOOTWEAR: GarmentType[] = ['boots', 'shoes', 'sneakers']
export const OUTER: GarmentType[] = ['coat', 'jacket']
export const CARRIED: GarmentType[] = ['belt', 'accessory', 'bag']

/**
 * At least one top, exactly one pair of trousers and one pair of shoes, at
 * most one coat or jacket and one tailored jacket, at most three things
 * carried, three to eight pieces in all.
 */
export function isWhole(types: GarmentType[]): boolean {
  const count = (group: GarmentType[]) => types.filter((type) => group.includes(type)).length
  return (
    count(TOPS) >= 1 &&
    count(BOTTOMS) === 1 &&
    count(FOOTWEAR) === 1 &&
    count(OUTER) <= 1 &&
    count(['tailoring']) <= 1 &&
    count(CARRIED) <= 3 &&
    types.length >= 3 &&
    types.length <= 8
  )
}

/**
 * Whether a look is still whole with these of its pieces (by id) left out and
 * nothing in their place. A piece whose removal fails this can only be swapped.
 */
export function wholeWithout(pieces: { id: number; garment_type: GarmentType }[], out: ReadonlySet<number>): boolean {
  return isWhole(pieces.filter((piece) => !out.has(piece.id)).map((piece) => piece.garment_type))
}

/** The longest note he can give with a remake: "lighter shoes, nothing black". */
export const REMAKE_NOTE_MAX = 200
