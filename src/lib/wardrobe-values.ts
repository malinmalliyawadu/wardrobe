import type { Budget } from './profile.ts'

/**
 * The closed vocabularies of the style guide and the blueprint, shared by
 * Claude's output formats, the forms and the database check constraints in
 * db/migrations/0002_blueprint_edits.sql. The finder (M3) filters on garment
 * type, so it is a fixed list rather than free text.
 */

export const GARMENT_TYPES = [
  'tee',
  'polo',
  'shirt',
  'overshirt',
  'knitwear',
  'sweatshirt',
  'trousers',
  'jeans',
  'shorts',
  'tailoring',
  'jacket',
  'coat',
  'activewear',
  'shoes',
  'boots',
  'sneakers',
  'accessory',
  'bag',
] as const

export const SLOT_STATUSES = ['wanted', 'candidate', 'owned', 'retired'] as const
export const PRIORITIES = [1, 2, 3] as const
export const METALS = ['gold', 'silver', 'mixed'] as const

export type GarmentType = (typeof GARMENT_TYPES)[number]
export type SlotStatus = (typeof SLOT_STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type Metal = (typeof METALS)[number]

export const GARMENT_LABELS: Record<GarmentType, string> = {
  tee: 'Tee',
  polo: 'Polo',
  shirt: 'Shirt',
  overshirt: 'Overshirt',
  knitwear: 'Knitwear',
  sweatshirt: 'Sweatshirt',
  trousers: 'Trousers',
  jeans: 'Jeans',
  shorts: 'Shorts',
  tailoring: 'Tailoring',
  jacket: 'Jacket',
  coat: 'Coat',
  activewear: 'Activewear',
  shoes: 'Shoes',
  boots: 'Boots',
  sneakers: 'Sneakers',
  accessory: 'Accessory',
  bag: 'Bag',
}

export const STATUS_LABELS: Record<SlotStatus, string> = {
  wanted: 'Wanted',
  candidate: 'Candidate',
  owned: 'Owned',
  retired: 'Retired',
}

export const PRIORITY_LABELS: Record<Priority, { title: string; hint: string }> = {
  1: { title: 'Buy first', hint: 'The foundation. Worn most, unlocks the most outfits.' },
  2: { title: 'Next', hint: 'Rounds the wardrobe out once the foundation is in.' },
  3: { title: 'In time', hint: 'Occasional pieces and upgrades.' },
}

/** Which budget ceiling on the profile governs each garment type. */
export const BUDGET_CATEGORY: Record<GarmentType, keyof Omit<Budget, 'monthly'>> = {
  tee: 'tees',
  polo: 'tees',
  activewear: 'tees',
  shirt: 'shirts',
  overshirt: 'shirts',
  knitwear: 'knits',
  sweatshirt: 'knits',
  trousers: 'trousers',
  jeans: 'trousers',
  shorts: 'trousers',
  tailoring: 'outerwear',
  jacket: 'outerwear',
  coat: 'outerwear',
  shoes: 'shoes',
  boots: 'shoes',
  sneakers: 'shoes',
  accessory: 'accessories',
  bag: 'accessories',
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** "#ABC", "abc", " #aabbcc " -> "#aabbcc"; anything else -> null. */
export function normaliseHex(value: string): string | null {
  const match = HEX.exec(value.trim())
  if (!match?.[1]) return null
  const digits = match[1].toLowerCase()
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits}`
}
