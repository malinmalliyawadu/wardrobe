import type { Sizes } from '../profile.ts'
import type { GarmentType } from '../wardrobe-values.ts'

/*
 * Rules, not Claude: which products are menswear, what garment each one is,
 * and what its size labels mean. They run at every ingest over every product,
 * so a rule change applies to the whole catalogue the next night. The rules
 * were calibrated against the eleven stores' real feeds on 2026-11-04; the
 * cases they settle are in tests/finder-classify.test.ts.
 */

export type Classification = {
  menswear: boolean
  garment_type: GarmentType | null
  garment_kind: string | null
}

export type ClassifyInput = {
  title: string
  productType: string | null
  tags: string[]
  vendor: string | null
  catalogue: 'menswear' | 'mixed'
}

// ---------------------------------------------------------------------------
// Garment type
// ---------------------------------------------------------------------------

type Rule = { pattern: RegExp; garment: GarmentType | null; kind?: string }

/**
 * Never a slot: judged on the product type and title together. A vest is an
 * undershirt or a singlet here, but a knit vest is knitwear.
 */
const NOT_CLOTHING =
  /\b(towels?|candles?|mugs?|posters?|stickers?|fragrances?|perfumes?|colognes?|eau de|parfum|skin ?care|soaps?|shampoo|conditioner|deodorant|gift ?cards?|vouchers?|cushions?|blankets?|vases?|toys?|dolls?|playing cards|keyrings?|key rings?|lanyards?|lighters?|umbrellas?|socks?|underwear|boxers?|briefs|trunks|swim\w*|boardshorts?|board shorts|pyjamas?|pajamas?|robes?|loungewear|sleepwear|bandanas?|wallets?|card ?holders?|sunglasses|eyewear|glasses|necklaces?|bracelets?|earrings?|pendants?|jewell?ery|chains?|cufflinks|tie ?clips?|laces|shoe care|insoles|grooming|(?<!\b(?:knit|knitted|sweater|jumper|cable|crochet)[\s-])vests?|bodysuits?|dress(es)?|skirts?|bras?|bralettes?|leggings|tights|wetsuits?|wet suits?|spring suits?|full suits?|rash ?guards?|rashies?|booties|gaiters?|suspenders|waders?)\b/i

/** Words that only exclude when they are the product type, because they turn up in titles ("Ring Spun Tee", "Book Club Shirt"). */
const NOT_CLOTHING_TYPE = /\b(rings?|books?|cards?|home|homewares?|art|prints?|magazines?|accessories - other|gift)\b/i

/**
 * Sport-specific kit: a running shoe, a golf polo, a gym tee. It is
 * activewear whatever garment it also is, so it never fills a style slot (the
 * blueprint asks for activewear by name when it wants it).
 */
const SPORT =
  /\b(running|run|trail|hiking|hike|basketball|football|soccer|golf|tennis|training|trainer tee|gym|cycling|cycle|active|activewear|performance|compression|base ?layer|workout|yoga|marathon|stability|gore-?tex trail|wading|ski|skiing|snowboard(ing)?|bibs|bib shorts?|capilene)\b/i

/** Most specific first. The first rule that matches wins. */
const RULES: Rule[] = [
  { pattern: /\b(boots?|chelseas?)\b/i, garment: 'boots' },
  { pattern: /\b(sneakers?|trainers?|runners?)\b/i, garment: 'sneakers' },
  {
    pattern: /\b(shoes?|loafers?|derby|derbies|brogues?|mules?|sandals?|slides?|espadrilles?|moccasins?|footwear)\b/i,
    garment: 'shoes',
  },
  {
    pattern: /\b(bags?|backpacks?|totes?|holdalls?|duffle|duffel|messenger|cross ?body|rucksacks?|satchels?|briefcases?|pouch|sacoche)\b/i,
    garment: 'bag',
  },
  { pattern: /\bbelts?\b/i, garment: 'belt' },
  { pattern: /\b(scarf|scarves|snood)\b/i, garment: 'accessory', kind: 'scarf' },
  { pattern: /\b(beanies?|watch caps?|toques?)\b/i, garment: 'accessory', kind: 'beanie' },
  { pattern: /\b(caps?|hats?|bucket)\b/i, garment: 'accessory', kind: 'cap' },
  { pattern: /\b(gloves?|mittens?)\b/i, garment: 'accessory', kind: 'gloves' },
  { pattern: /\bwatch(es)?\b/i, garment: 'accessory', kind: 'watch' },
  { pattern: /\b(neck ?ties?|bow ?ties?|ties|pocket squares?)\b/i, garment: 'accessory', kind: 'tie' },
  // Bottoms before tops, so "sweat short" is shorts and "knit pant" trousers,
  // but a short-sleeve shirt is not a pair of shorts.
  { pattern: /\b(jeans?|selvage|selvedge)\b/i, garment: 'jeans' },
  { pattern: /\bshorts?\b(?![\s-]*sleeve)/i, garment: 'shorts' },
  {
    pattern: /\b(trousers?|pants?|chinos?|slacks|cords|joggers?|track ?pants?|sweatpants?)\b/i,
    garment: 'trousers',
  },
  { pattern: /\b(blazers?|suits?|sport ?coats?|tuxedos?|waistcoats?)\b/i, garment: 'tailoring' },
  { pattern: /\b(over ?shirts?|over-shirts?|shackets?|shirt jackets?|cpo)\b/i, garment: 'overshirt' },
  { pattern: /\b(polos?|rugby)\b/i, garment: 'polo' },
  { pattern: /\b(tanks?|singlets?)\b/i, garment: 'tank' },
  { pattern: /\b(t-?shirts?|tees?|henleys?)\b/i, garment: 'tee' },
  // Insulation named like a knit (Patagonia's Down Sweater, a Micro Puff Hoody) is a jacket.
  { pattern: /\b(down|puff(er)?|nano-air|insulated)\b.*\b(sweaters?|hoody|hoodies?|pullovers?|jumpers?)\b/i, garment: 'jacket' },
  {
    pattern: /\b(sweat ?shirts?|sweats?|sweat tops?|hoodies?|hoody|hoods?|hooded sweat|crew sweat|fleece)\b/i,
    garment: 'sweatshirt',
  },
  {
    pattern: /\b(knits?|knitted|knitwear|sweaters?|jumpers?|cardigans?|pullovers?|roll ?necks?|turtlenecks?|mock necks?|crew ?necks?|v-?necks?|half ?zips?|quarter ?zips?)\b/i,
    garment: 'knitwear',
  },
  { pattern: /\bshirts?\b/i, garment: 'shirt' },
  // A long-sleeve top or jersey that is not a shirt or a knit is a long-sleeve tee.
  { pattern: /\b(long ?sleeves?( tops?| jerseys?)?|l\/s tops?|ls tops?)\b/i, garment: 'tee' },
  {
    pattern: /\b(coats?|parkas?|trench|overcoats?|topcoats?|peacoats?|pea coats?|macs?|duffle coats?)\b/i,
    garment: 'coat',
  },
  {
    pattern: /\b(jackets?|bombers?|shells?|anoraks?|windbreakers?|harringtons?|blousons?|gilets?|puffers?|cagoules?|rain ?jackets?)\b/i,
    garment: 'jacket',
  },
  // Denim that is not a jacket or a shirt by now is a pair of jeans.
  { pattern: /\bdenim\b/i, garment: 'jeans' },
]

/** "Merino Crew" says knitwear only once the product type says so; these types settle it on their own. */
const TYPE_ONLY: Rule[] = [
  { pattern: /\b(knitwear|knits?)\b/i, garment: 'knitwear' },
  { pattern: /\b(outerwear)\b/i, garment: 'jacket' },
  { pattern: /\b(tops?)\b/i, garment: null },
]

/** Tags some stores use for their category ("cat_low:Sneakers", "Type:Sneakers"); END. leaves product_type empty and relies on them. */
const CATEGORY_TAG = /^(cat_low|cat_med|type|category|product_type):\s*(.+)$/i

export function categoryText(productType: string | null, tags: string[]): string {
  const fromTags = tags.flatMap((tag) => {
    const match = CATEGORY_TAG.exec(tag)
    return match ? [match[2]!] : []
  })
  return [productType ?? '', ...fromTags].filter(Boolean).join(' / ')
}

export function garmentOf(
  title: string,
  productType: string | null,
  options: { sport?: boolean } = {},
): { garment_type: GarmentType | null; garment_kind: string | null } {
  const type = productType ?? ''
  const text = `${title} | ${type}`
  if (NOT_CLOTHING.test(text) || NOT_CLOTHING_TYPE.test(type)) return { garment_type: null, garment_kind: null }
  if (options.sport !== false && SPORT.test(text)) return { garment_type: 'activewear', garment_kind: null }
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return { garment_type: rule.garment, garment_kind: rule.kind ?? null }
  }
  for (const rule of TYPE_ONLY) {
    if (rule.pattern.test(type)) return { garment_type: rule.garment, garment_kind: rule.kind ?? null }
  }
  return { garment_type: null, garment_kind: null }
}

/**
 * What a piece of sport kit is as a garment, for a piece he owns: a training
 * tank is a tank, running shorts are shorts. Pieces say they are for the gym
 * on their own (worn_for), so the finder's activewear catch-all is left out.
 */
export function kitGarmentOf(title: string, productType: string | null): GarmentType | null {
  return garmentOf(title, productType, { sport: false }).garment_type
}

/** The accessory kind a slot asks for, from its name ("Espresso fine merino beanie" -> "beanie"). */
export function slotKind(garment: GarmentType, name: string): string | null {
  if (garment !== 'accessory') return null
  for (const rule of RULES) {
    if (rule.garment === 'accessory' && rule.pattern.test(name)) return rule.kind ?? null
  }
  return null
}

// ---------------------------------------------------------------------------
// Menswear
// ---------------------------------------------------------------------------

const WOMEN = /\b(women'?s?|womens|womenswear|woman|ladies|female|her|wmns|gender:womens)\b/i
const MEN = /\b(men'?s?|mens|menswear|man|male|his|gender:mens|unisex)\b/i
const KIDS = /\b(kids?|child|children|childrens|boys?|girls?|baby|babies|junior|youth|toddlers?|infants?|teens?)\b/i
/** A tag that sets the gender on purpose ("Gender:Men"), as against a loose "Mens" tag. */
const GENDER_MEN_TAG = /^gender:\s*(men|mens|male|unisex)$/i

/**
 * Menswear from the words a store uses. A menswear-only store needs only to
 * not say women or kids; a mixed store has to say men (or unisex) somewhere in
 * the type, tags or title, and is not menswear if it says women and not men.
 * A product type that says women and not men is the store's own filing and
 * outweighs a loose men tag (Bronze Snake tags women's pieces in its men's
 * collection "Mens"), though not a gender tag.
 */
export function isMenswear(input: Pick<ClassifyInput, 'title' | 'productType' | 'tags' | 'catalogue'>): boolean {
  const words = [input.productType ?? '', input.title, ...input.tags].join(' | ')
  if (KIDS.test(words)) return false
  const type = input.productType ?? ''
  if (WOMEN.test(type) && !MEN.test(type) && !input.tags.some((tag) => GENDER_MEN_TAG.test(tag))) return false
  const men = MEN.test(words)
  const women = WOMEN.test(words)
  if (input.catalogue === 'menswear') return men || !women
  return men
}

export function classify(input: ClassifyInput): Classification {
  return { menswear: isMenswear(input), ...garmentOf(input.title, categoryText(input.productType, input.tags)) }
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

export type SizeGroup = 'tops' | 'bottoms' | 'feet' | 'other'

export function sizeGroup(garment: GarmentType | null): SizeGroup {
  switch (garment) {
    case 'trousers':
    case 'jeans':
    case 'shorts':
      return 'bottoms'
    case 'shoes':
    case 'boots':
    case 'sneakers':
      return 'feet'
    case 'belt':
    case 'accessory':
    case 'bag':
    case null:
      return 'other'
    default:
      return 'tops'
  }
}

const LETTERS: Record<string, string> = {
  xxs: 'XXS', '2xs': 'XXS', 'xx-small': 'XXS', xxsmall: 'XXS',
  xs: 'XS', 'x-small': 'XS', xsmall: 'XS', 'extra small': 'XS', 'extra-small': 'XS',
  s: 'S', sm: 'S', small: 'S',
  m: 'M', med: 'M', medium: 'M',
  l: 'L', lg: 'L', large: 'L',
  xl: 'XL', 'x-large': 'XL', xlarge: 'XL', 'extra large': 'XL', 'extra-large': 'XL',
  xxl: 'XXL', '2xl': 'XXL', 'xx-large': 'XXL', xxlarge: 'XXL', 'xx large': 'XXL',
  xxxl: 'XXXL', '3xl': 'XXXL', 'xxx-large': 'XXXL', 'xxx large': 'XXXL',
}
const LETTER_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
const ONE = /^(one ?size|os|o\/s|osf|osa|one size fits all|osfa|no size|default title|n\/a|1 ?size|all|all sizes?)$/i

/**
 * A size label as a key the filter can compare: "S", "S/M", "W30", "EU42",
 * "UK8", "US9", "C46" (European chest, tailoring and knitwear), "R38" (UK and
 * US chest in inches), "ONE". Null when the label is not understood. The
 * garment type decides what a bare number means; with none given, only
 * unambiguous labels are read.
 */
export function sizeKey(label: string, garment: GarmentType | null): string | null {
  const value = label.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!value) return null
  if (ONE.test(value)) return 'ONE'

  const letter = LETTERS[value]
  if (letter) return letter
  // Japanese and Scandinavian numbering with the letter alongside: "2 (S)".
  const bracketed = /^\d \(([a-z ]+)\)$/.exec(value)
  if (bracketed && LETTERS[bracketed[1]!.trim()]) return LETTERS[bracketed[1]!.trim()]!

  // Inches: '34"', "34 inch Waist x 32 inch Leg". A waist for trousers and belts, a chest for tops.
  const inches = /^(\d{2})\s*(?:"|''|inch(?:es)?|in)(?:\s*waist)?(?:\s*x\s*\d{2}\s*(?:"|''|inch(?:es)?|in)?\s*leg)?$/.exec(value)
  if (inches) return sizeGroup(garment) === 'tops' ? `R${inches[1]}` : `W${inches[1]}`
  const pair = /^([a-z0-9-]+) ?[/-] ?([a-z0-9-]+)$/.exec(value)
  if (pair && LETTERS[pair[1]!] && LETTERS[pair[2]!]) return `${LETTERS[pair[1]!]}/${LETTERS[pair[2]!]}`

  const prefixed = /^(eu|uk|us|it|fr|w)\.? ?(\d{1,2}(?:\.5)?)$/.exec(value) ?? /^(\d{1,2}(?:\.5)?) ?(eu|uk|us|it|w)$/.exec(value)
  if (prefixed) {
    const [system, number] = /^\d/.test(prefixed[1]!) ? [prefixed[2]!, prefixed[1]!] : [prefixed[1]!, prefixed[2]!]
    const group = sizeGroup(garment)
    if (system === 'w') return `W${number}`
    if (group === 'tops' && (system === 'it' || system === 'eu' || system === 'fr')) return `C${number}`
    if (system === 'it' || system === 'fr') return group === 'bottoms' ? `EUW${number}` : `C${number}`
    return `${system.toUpperCase()}${number}`
  }

  // Waist by leg: "30/32", "30 x 32", "30W 32L", "W30 L32".
  const waistLeg = /^w?(\d{2})w? ?(?:[x/]|l) ?l?(\d{2})l?$/.exec(value)
  if (waistLeg) return `W${waistLeg[1]}`

  // Chest with a fit letter: "38R", "40L", "36S".
  const chest = /^(\d{2}) ?(r|s|l|reg|regular|short|long)$/.exec(value)
  if (chest && sizeGroup(garment) === 'tops') return `R${chest[1]}`

  const bare = /^(\d{1,2}(?:\.5)?)$/.exec(value)
  if (bare && garment) {
    const number = Number(bare[1])
    switch (sizeGroup(garment)) {
      case 'bottoms':
        return number >= 26 && number <= 44 ? `W${bare[1]}` : null
      case 'feet':
        return number >= 35 ? `EU${bare[1]}` : null
      case 'tops':
        if (number >= 42 && number <= 58 && Number.isInteger(number)) return `C${bare[1]}`
        if (number >= 34 && number <= 48 && Number.isInteger(number)) return `R${bare[1]}`
        return null
      default:
        return null
    }
  }
  return null
}

/** European chest sizes for a letter size, for tailoring and knitwear labelled 44, 46, 48. */
const LETTER_TO_EU_CHEST: Record<string, string[]> = {
  XS: ['C44'],
  S: ['C46'],
  M: ['C48'],
  L: ['C50'],
  XL: ['C52'],
  XXL: ['C54'],
}
const LETTER_TO_CHEST_IN: Record<string, string[]> = {
  XS: ['R34', 'R36'],
  S: ['R36', 'R38'],
  M: ['R38', 'R40'],
  L: ['R42'],
  XL: ['R44'],
  XXL: ['R46'],
}

/** The keys that mean "his size" for a letter: the letter, every pair containing it, and its chest numbers. */
function letterKeys(letter: string): string[] {
  const index = LETTER_ORDER.indexOf(letter)
  if (index < 0) return []
  const pairs = [LETTER_ORDER[index - 1], LETTER_ORDER[index + 1]]
    .filter((other): other is string => Boolean(other))
    .flatMap((other) => [`${letter}/${other}`, `${other}/${letter}`])
  return [letter, ...pairs, ...(LETTER_TO_EU_CHEST[letter] ?? []), ...(LETTER_TO_CHEST_IN[letter] ?? [])]
}

/**
 * The size keys to look for on a slot of this garment, from the slot's own
 * labels when it has them, otherwise from the profile. Null means his size for
 * this garment is not known yet, and the filter accepts any size in stock (and
 * says so on the card) rather than finding nothing.
 */
export function wantedSizeKeys(
  garment: GarmentType,
  slotLabels: string[],
  sizes: Partial<Sizes>,
): string[] | null {
  const fromLabels = slotLabels.flatMap((label) => {
    const key = sizeKey(label, garment)
    if (!key) return []
    return LETTER_ORDER.includes(key) ? letterKeys(key) : [key]
  })
  if (fromLabels.length > 0) return [...new Set(fromLabels)]

  switch (sizeGroup(garment)) {
    case 'tops':
      return sizes.tee ? letterKeys(sizes.tee) : null
    case 'bottoms':
      return sizes.waist_cm ? [`W${Math.round(sizes.waist_cm / 2.54)}`] : null
    case 'feet': {
      const keys = [
        sizes.shoe_eu ? `EU${sizes.shoe_eu}` : null,
        sizes.shoe_uk ? `UK${sizes.shoe_uk}` : null,
        sizes.shoe_us ? `US${sizes.shoe_us}` : null,
      ].filter((key): key is string => key !== null)
      return keys.length > 0 ? keys : null
    }
    default:
      return null
  }
}
