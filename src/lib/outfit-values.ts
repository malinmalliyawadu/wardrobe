/*
 * What an outfit from scratch can be made from (outfit.ts), apart from the
 * database code so the form can run in the browser.
 */

export const OUTFIT_SOURCES = ['wardrobe', 'shops', 'both', 'anywhere'] as const
export type OutfitSource = (typeof OUTFIT_SOURCES)[number]

export const SOURCE_LABELS: Record<OutfitSource, string> = {
  wardrobe: 'My wardrobe',
  shops: 'The shops',
  both: 'Both',
  anywhere: 'Anything',
}

/** The sources that use his own clothes, and the ones that read the shops. */
export const usesWardrobe = (source: OutfitSource) => source === 'wardrobe' || source === 'both'
export const usesShops = (source: OutfitSource) => source === 'shops' || source === 'both'

/** The longest brief he can give: "a wedding on Saturday, outdoors, nothing black". */
export const BRIEF_MAX = 300
