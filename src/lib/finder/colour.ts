/*
 * The colour rule: free, and only ever a "no". A product is dropped from a
 * slot when every colour word it uses names a family the slot is not in, nor
 * next to: a black tee is not a candidate for the ecru tee. A product whose
 * colour the words do not settle ("Walnut/Chalk" settles it; "Billed" does
 * not) stays, and Claude judges it from the photo. Families are coarse on
 * purpose; telling pine from bottle green is the scorer's job.
 */

export const FAMILIES = [
  'black',
  'grey',
  'white',
  'ecru',
  'beige',
  'brown',
  'navy',
  'blue',
  'teal',
  'green',
  'olive',
  'red',
  'rust',
  'yellow',
  'pink',
  'purple',
] as const

export type Family = (typeof FAMILIES)[number]

/** Longest phrases first, so "off white" is ecru before "white" is white. */
const WORDS: [string, Family][] = (
  [
    ['off white', 'ecru'], ['off-white', 'ecru'], ['bright white', 'white'], ['optic white', 'white'],
    ['dark brown', 'brown'], ['light brown', 'brown'], ['dark navy', 'navy'], ['dark blue', 'navy'],
    ['deep blue', 'navy'], ['light blue', 'blue'], ['sky blue', 'blue'], ['steel blue', 'blue'],
    ['deep teal', 'teal'], ['dark green', 'green'], ['bottle green', 'green'], ['forest green', 'green'],
    ['army green', 'olive'], ['khaki green', 'olive'], ['burnt orange', 'rust'], ['dark red', 'red'],
    ['stone wash', 'blue'], ['stonewash', 'blue'], ['stone washed', 'blue'], ['grey marle', 'grey'], ['gray marle', 'grey'], ['dark grey', 'grey'], ['light grey', 'grey'],
    ['black', 'black'], ['jet', 'black'], ['onyx', 'black'], ['ebony', 'black'], ['noir', 'black'], ['nero', 'black'], ['caviar', 'black'], ['coal', 'black'],
    ['obsidian', 'black'], ['liquorice', 'black'], ['licorice', 'black'],
    ['charcoal', 'grey'], ['grey', 'grey'], ['gray', 'grey'], ['slate', 'grey'], ['graphite', 'grey'], ['ash', 'grey'],
    ['smoke', 'grey'], ['pewter', 'grey'], ['steel', 'grey'], ['gunmetal', 'grey'], ['marle', 'grey'], ['heather', 'grey'],
    ['silver', 'grey'], ['anthracite', 'grey'], ['granite', 'grey'],
    ['white', 'white'], ['snow', 'white'], ['optic', 'white'], ['blanc', 'white'],
    ['ecru', 'ecru'], ['cream', 'ecru'], ['ivory', 'ecru'], ['natural', 'ecru'], ['oat', 'ecru'], ['oatmeal', 'ecru'],
    ['bone', 'ecru'], ['vanilla', 'ecru'], ['milk', 'ecru'], ['undyed', 'ecru'], ['eggshell', 'ecru'], ['chalk', 'ecru'],
    ['calico', 'ecru'], ['parchment', 'ecru'], ['sail', 'ecru'], ['alabaster', 'ecru'], ['coconut', 'ecru'],
    ['beige', 'beige'], ['barley', 'beige'], ['putty', 'beige'], ['stone', 'beige'], ['sand', 'beige'], ['khaki', 'beige'], ['camel', 'beige'],
    ['taupe', 'beige'], ['mushroom', 'beige'], ['fawn', 'beige'], ['biscuit', 'beige'], ['wheat', 'beige'],
    ['desert', 'beige'], ['dune', 'beige'], ['flax', 'beige'], ['latte', 'beige'], ['tan', 'beige'],
    ['brown', 'brown'], ['chocolate', 'brown'], ['espresso', 'brown'], ['coffee', 'brown'], ['mocha', 'brown'],
    ['cocoa', 'brown'], ['walnut', 'brown'], ['chestnut', 'brown'], ['tobacco', 'brown'], ['cognac', 'brown'],
    ['mahogany', 'brown'], ['nutmeg', 'brown'], ['umber', 'brown'], ['java', 'brown'], ['bark', 'brown'], ['truffle', 'brown'],
    ['hazel', 'brown'], ['toffee', 'brown'], ['caramel', 'brown'], ['brunette', 'brown'], ['tortoise', 'brown'],
    ['navy', 'navy'], ['ink', 'navy'], ['midnight', 'navy'], ['indigo', 'navy'], ['marine', 'navy'], ['nautical', 'navy'],
    ['blue', 'blue'], ['cobalt', 'blue'], ['royal', 'blue'], ['sky', 'blue'], ['powder', 'blue'], ['azure', 'blue'],
    ['cornflower', 'blue'], ['chambray', 'blue'], ['denim', 'blue'], ['cerulean', 'blue'], ['ocean', 'blue'], ['lapis', 'blue'],
    ['teal', 'teal'], ['petrol', 'teal'], ['peacock', 'teal'], ['aqua', 'teal'], ['aquamarine', 'teal'], ['turquoise', 'teal'],
    ['green', 'green'], ['pine', 'green'], ['forest', 'green'], ['bottle', 'green'], ['emerald', 'green'],
    ['hunter', 'green'], ['sage', 'green'], ['mint', 'green'], ['spearmint', 'green'], ['eucalyptus', 'green'], ['kelly', 'green'], ['fern', 'green'],
    ['jade', 'green'], ['spruce', 'green'], ['evergreen', 'green'], ['ivy', 'green'], ['racing green', 'green'],
    ['olive', 'olive'], ['army', 'olive'], ['military', 'olive'], ['moss', 'olive'], ['fatigue', 'olive'],
    ['loden', 'olive'], ['khaki olive', 'olive'], ['lichen', 'olive'],
    ['red', 'red'], ['burgundy', 'red'], ['oxblood', 'red'], ['maroon', 'red'], ['wine', 'red'], ['claret', 'red'],
    ['bordeaux', 'red'], ['garnet', 'red'], ['merlot', 'red'], ['cherry', 'red'], ['crimson', 'red'], ['scarlet', 'red'], ['cranberry', 'red'],
    ['brick', 'rust'], ['rust', 'rust'], ['orange', 'rust'], ['terracotta', 'rust'], ['copper', 'rust'],
    ['ginger', 'rust'], ['amber', 'rust'], ['pumpkin', 'rust'], ['paprika', 'rust'], ['cinnamon', 'rust'], ['sienna', 'rust'],
    ['yellow', 'yellow'], ['mustard', 'yellow'], ['ochre', 'yellow'], ['lemon', 'yellow'], ['butter', 'yellow'], ['gold', 'yellow'],
    ['pink', 'pink'], ['rose', 'pink'], ['blush', 'pink'], ['flamingo', 'pink'], ['salmon', 'pink'], ['fuchsia', 'pink'], ['coral', 'pink'],
    ['purple', 'purple'], ['aubergine', 'purple'], ['plum', 'purple'], ['lilac', 'purple'], ['lavender', 'purple'], ['orchid', 'purple'],
    ['violet', 'purple'], ['mauve', 'purple'], ['grape', 'purple'], ['eggplant', 'purple'], ['damson', 'purple'],
  ] as [string, Family][]
).sort((a, b) => b[0].length - a[0].length)

const PATTERNS = WORDS.map(([word, family]) => ({
  pattern: new RegExp(`(^|[^a-z])${word.replace(/[-\s]/g, '[-\\s]?')}(?=$|[^a-z])`, 'i'),
  family,
  word,
}))

/**
 * "OFF WHITE" -> "Off White", as the Shopify stores write colours, in NZ
 * spelling and with the shorthand some shops use ("DK GREEN") written out.
 */
export function colourName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\bgray\b/g, 'grey')
    .replace(/\bdk\b\.?/g, 'dark')
    .replace(/\blt\b\.?/g, 'light')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

/** Families each family sits next to: a near miss the scorer should still see. */
const NEIGHBOURS: Record<Family, Family[]> = {
  black: ['grey'],
  grey: ['black'],
  white: ['ecru'],
  ecru: ['beige'],
  beige: ['ecru', 'brown'],
  brown: ['beige', 'rust'],
  navy: ['blue'],
  blue: ['navy', 'teal'],
  teal: ['green', 'blue'],
  green: ['teal', 'olive'],
  olive: ['green', 'beige'],
  red: ['rust', 'purple'],
  rust: ['red', 'brown'],
  yellow: ['rust'],
  pink: ['red'],
  purple: ['red'],
}

/** Every family the text names, consuming the longest phrases first. */
export function familiesIn(text: string): Family[] {
  let rest = ` ${text.toLowerCase()} `
  const found = new Set<Family>()
  for (const { pattern, family } of PATTERNS) {
    if (pattern.test(rest)) {
      found.add(family)
      rest = rest.replace(new RegExp(pattern.source, 'gi'), ' ')
    }
  }
  return [...found]
}

/** A slot's own family and its neighbours, from its name, its plain colour words and its guide colour names. */
export function slotFamilies(colourWords: string[]): Family[] | null {
  const own = new Set(colourWords.flatMap(familiesIn))
  if (own.size === 0) return null
  const all = new Set<Family>(own)
  for (const family of own) for (const neighbour of NEIGHBOURS[family]) all.add(neighbour)
  return [...all]
}

/**
 * The families a product offers. Variant colour options, when the store has
 * them, are the most direct; otherwise the title (where most stores put the
 * colour) with the brand taken out, since brands carry colour words (Stone
 * Island, Marine Serre); then colour tags ("Colour:Black", or a bare "Black").
 */
export function productFamilies(product: { title: string; vendor: string | null; colours: string[]; tags: string[] }): Family[] {
  if (product.colours.length > 0) {
    const fromOptions = product.colours.flatMap(familiesIn)
    if (fromOptions.length > 0) return [...new Set(fromOptions)]
  }
  const vendor = product.vendor?.trim()
  const title = vendor ? product.title.replace(new RegExp(vendor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ') : product.title
  const fromTitle = familiesIn(title)
  if (fromTitle.length > 0) return fromTitle
  const colourTags = product.tags.flatMap((tag) => {
    const match = /^colou?r\s*:\s*(.+)$/i.exec(tag)
    if (match) return [match[1]!]
    return familiesIn(tag).length > 0 && tag.split(/\s+/).length <= 2 ? [tag] : []
  })
  return [...new Set(colourTags.flatMap(familiesIn))]
}

/** False only when the product names colours and none of them is the slot's. */
export function colourCompatible(slot: Family[] | null, product: Family[]): boolean {
  if (slot === null || product.length === 0) return true
  return product.some((family) => slot.includes(family))
}

// ---------------------------------------------------------------------------
// Cut: the same kind of rule for the fit a listing names about itself.
// ---------------------------------------------------------------------------

const NAMED_CUTS: { pattern: RegExp; fit: 'oversized' | 'relaxed' }[] = [
  { pattern: /\b(over ?sized?|over-sized|boxy|box (fit|tee|t-shirt|shirt)|heavy box|baggy|extra relaxed|super relaxed|balloon)\b/i, fit: 'oversized' },
  { pattern: /\b(relaxed|loose|drop shoulder|dropped shoulder)\b/i, fit: 'relaxed' },
]

/** The cut a listing says it is, when it says: "Heavy Box Tee" is oversized. */
export function namedCut(text: string): 'oversized' | 'relaxed' | null {
  for (const cut of NAMED_CUTS) if (cut.pattern.test(text)) return cut.fit
  return null
}

/** False only when the listing names a cut the slot and the guide do not allow. */
export function cutCompatible(allowed: string[] | null, cut: string | null): boolean {
  if (allowed === null || allowed.length === 0 || cut === null) return true
  return allowed.includes(cut)
}
