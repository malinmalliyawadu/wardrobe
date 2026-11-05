import { z } from 'zod'

import { classify, sizeKey } from './classify.ts'
import { colourName } from './colour.ts'
import { FetchError, type PoliteClient } from './http.ts'
import { contentHash, type NormalisedProduct, type NormalisedVariant, type ProductImage } from './shopify.ts'

/*
 * Rodd & Gunn, read one colour at a time from a link Malin pastes. The site
 * is Salesforce Commerce Cloud: no products.json, and its catalogue is a page
 * per colour (about 2,500), too many to walk each night at a page a second,
 * so it is never walked, like Uniqlo. Its product pages are allowed by
 * robots.txt and answer the finder's own User-Agent.
 *
 * A colour's page is server-rendered with everything a find needs: a
 * schema.org Product (name, description, NZD price, whether it is in stock),
 * the canonical link, the data layer's view_item (the id, the price it sells
 * at, its category and colour), the usual price beside a sale price, the
 * colour's own photos, and its sizes, each marked selectable or not for that
 * colour, which is stock per size. Trousers and jeans come in leg lengths,
 * and each length is its own page and id ("006171-19" Regular, "006171-20"
 * Short) whose size row answers for that length; every page links the
 * others. One colour is one product, so a colour's lengths are read
 * together and stored as one, its sizes named with their length
 * ("Coal / 32 / Short"), under the Regular page's id.
 */

const VENDOR = 'Rodd & Gunn'

/**
 * A colour's id is the style's six digits and the colour's two or three
 * ("006171-19", "003396-111"); a size's page adds the size ("006171-19-44",
 * "003396-111-ME"), and a style's page has the style alone ("006171").
 */
const COLOUR = String.raw`\d{6}-\d{2,3}`
const PAGE_PATH = new RegExp(String.raw`\/(\d{6}(?:-\d{2,3})?)(?:-[A-Z0-9]{1,4})?\.html$`, 'i')
const COLOUR_ID = new RegExp(`^${COLOUR}$`)

/** The id a page link is for: the style and colour ("006171-19"), or a style alone ("006171"). Null for any other page. */
export function roddAndGunnId(url: URL): string | null {
  return idOfPath(url.pathname)
}

function idOfPath(path: string): string | null {
  return PAGE_PATH.exec(path)?.[1] ?? null
}

/** The page for an id on the store's own region. The site redirects it to the colour's canonical page. */
export function roddAndGunnPageUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/${id}.html`
}

// ---------------------------------------------------------------------------
// One page
// ---------------------------------------------------------------------------

export class RoddAndGunnPageError extends Error {}

/** A style's page with no colour chosen: the link has to say which colour. */
export class RoddAndGunnStylePage extends RoddAndGunnPageError {
  readonly colours: { name: string; url: string }[]

  constructor(colours: { name: string; url: string }[]) {
    super('the page is for a style, with no colour chosen')
    this.colours = colours
  }
}

const LdProductSchema = z.object({
  '@type': z.literal('Product'),
  name: z.string(),
  description: z.string().nullish(),
  url: z.string().url(),
  offers: z.object({
    price: z.coerce.number(),
    priceCurrency: z.string().length(3),
    availability: z.string().nullish(),
  }),
})

const ViewItemSchema = z.object({
  event: z.literal('view_item'),
  ecommerce: z.object({
    items: z
      .array(
        z.object({
          item_id: z.string(),
          item_name: z.string(),
          price: z.coerce.number(),
          item_category: z.string().nullish(),
          item_category2: z.string().nullish(),
          item_variant: z.string().nullish(),
        }),
      )
      .min(1),
  }),
})

export type RoddAndGunnSize = { code: string; label: string; available: boolean }
export type RoddAndGunnLength = { id: string; label: string; path: string }

export type RoddAndGunnPage = {
  /** The style and colour (and leg length), "006171-19". */
  id: string
  name: string
  description: string | null
  /** The "Designer Notes" list: the fit, the fabric, the details. */
  notes: string[]
  /** The canonical page for this colour. */
  url: string
  currency: string
  /** What it sells at now, in dollars. */
  price: number
  /** The usual price, when it is marked down. */
  was: number | null
  inStock: boolean
  /** "Clothing", "Outlet", "Footwear", "Accessories". */
  category: string | null
  /** The data layer's second category: "Shirts", "Jackets & Coats", "Boots", or a list such as "New Arrivals". */
  type: string | null
  /** The breadcrumb between Home and the product: ["Clothing", "Jackets & Coats", "Coats"]. */
  crumbs: string[]
  colour: string | null
  images: string[]
  /** Empty for a piece sold in one size. */
  sizes: RoddAndGunnSize[]
  /** Every leg length the colour comes in, this page's among them. Empty for anything without one. */
  lengths: RoddAndGunnLength[]
}

/** Reads a product page. Throws RoddAndGunnStylePage for a style with no colour chosen. */
export function readRoddAndGunnPage(html: string): RoddAndGunnPage {
  const ld = productLd(html)
  const view = viewItem(html)
  // A size's page names the size too ("009989-01-XXL"); a style's page names no colour ("006582").
  const id = new RegExp(`^(${COLOUR})(?:-|$)`).exec(view.item_id)?.[1]
  if (!id) throw new RoddAndGunnStylePage(colourSwatches(html))

  const was = money(/<span class="price-standard">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? '')
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]
  return {
    id,
    // A size's page names the colour and size after the product: "Guards Bay Coat · Onyx XXL".
    name: tidyText(ld.name).split(' · ')[0]!.trim(),
    description: ld.description ? tidyText(ld.description) : null,
    notes: designerNotes(html),
    url: canonical ? decodeEntities(canonical) : ld.url,
    currency: ld.offers.priceCurrency,
    price: view.price,
    was: was !== null && was > view.price ? was : null,
    inStock: /\/(InStock|LimitedAvailability|OnlineOnly)$/.test(ld.offers.availability ?? ''),
    category: view.item_category?.trim() || null,
    type: view.item_category2?.trim() || null,
    crumbs: breadcrumb(html),
    colour: view.item_variant?.trim() || null,
    images: photos(html, id),
    sizes: sizeSwatches(html),
    lengths: lengthSwatches(html),
  }
}

function productLd(html: string): z.infer<typeof LdProductSchema> {
  for (const match of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let data: unknown
    try {
      data = JSON.parse(match[1]!)
    } catch {
      continue
    }
    const product = LdProductSchema.safeParse(data)
    if (product.success) return product.data
  }
  throw new RoddAndGunnPageError('the page has no schema.org Product')
}

function viewItem(html: string): z.infer<typeof ViewItemSchema>['ecommerce']['items'][number] {
  const start = html.indexOf('{"event":"view_item"')
  if (start < 0) throw new RoddAndGunnPageError('the page has no view_item in its data layer')
  const end = html.indexOf('</script>', start)
  const source = html.slice(start, end < 0 ? undefined : end).trim().replace(/\)\s*;?\s*$/, '')
  let data: unknown
  try {
    data = JSON.parse(source)
  } catch {
    throw new RoddAndGunnPageError('the view_item is not JSON')
  }
  const parsed = ViewItemSchema.safeParse(data)
  if (!parsed.success) throw new RoddAndGunnPageError('the view_item is not in the shape it was')
  return parsed.data.ecommerce.items[0]!
}

/** "$159.00" -> 159. */
function money(text: string): number | null {
  const match = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(stripTags(text))
  return match ? Number(match[1]!.replace(/,/g, '')) : null
}

function breadcrumb(html: string): string[] {
  const start = html.indexOf('<ol class="breadcrumb"')
  if (start < 0) return []
  const block = html.slice(start, html.indexOf('</ol>', start))
  const names = [...block.matchAll(/<span itemprop="name">([^<]*)<\/span>/g)].map((match) => tidyText(match[1]!))
  // Home first, the product itself last.
  return names.slice(1, -1).filter(Boolean)
}

function designerNotes(html: string): string[] {
  const start = html.indexOf('product-designer-note')
  if (start < 0) return []
  const end = html.indexOf('</ul>', start)
  if (end < 0) return []
  return [...html.slice(start, end).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => tidyText(match[1]!)).filter(Boolean)
}

/**
 * The colour's own photos, largest first as the page lists them, as the
 * image service's address so they can be asked for at a width
 * (src/lib/product-image.ts). The zoom images are the originals.
 */
function photos(html: string, id: string): string[] {
  const realm = /\/dw\/image\/v2\/([A-Za-z0-9_]+)\/on\/demandware\.static\//.exec(html)?.[1] ?? null
  const seen = new Set<string>()
  for (const match of html.matchAll(/<[^>]*\bdata-zoom-img="([^"]+)"[^>]*>/g)) {
    const pid = /\bdata-pid="([^"]+)"/.exec(match[0])?.[1]
    if (pid !== id && !pid?.startsWith(`${id}-`)) continue
    const src = decodeEntities(match[1]!)
    seen.add(realm ? src.replace('/on/demandware.static/', `/dw/image/v2/${realm}/on/demandware.static/`) : src)
  }
  return [...seen]
}

/** The swatches in one of the variation lists ("size", "leglength", "color"). */
function swatchList(html: string, name: string): string | null {
  const start = html.indexOf(`<ul class="swatches ${name}"`)
  if (start < 0) return null
  return html.slice(start, html.indexOf('</ul>', start))
}

function sizeSwatches(html: string): RoddAndGunnSize[] {
  const list = swatchList(html, 'size')
  if (!list) return []
  return [...list.matchAll(/<li[^>]*class='size-swatches([^']*)'[^>]*>([\s\S]*?)<\/li>/g)].flatMap((match) => {
    const label = tidyText(/<button[^>]*>([\s\S]*?)<\/button>/.exec(match[2]!)?.[1] ?? '')
    const code = /dwvar_\d+_size=([^&"]+)/.exec(match[2]!)?.[1] ?? label
    return label ? [{ code: decodeURIComponent(code), label, available: !/\bunselectable\b/.test(match[1]!) }] : []
  })
}

function lengthSwatches(html: string): RoddAndGunnLength[] {
  const list = swatchList(html, 'leglength')
  if (!list) return []
  return [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].flatMap((match) => {
    const path = /data-product-url="([^"]+)"/.exec(match[1]!)?.[1]
    const id = path ? idOfPath(decodeEntities(path)) : null
    const label = tidyText(/<button[^>]*>([\s\S]*?)<\/button>/.exec(match[1]!)?.[1] ?? '')
    return path && id && COLOUR_ID.test(id) && label ? [{ id, label, path: decodeEntities(path) }] : []
  })
}

function colourSwatches(html: string): { name: string; url: string }[] {
  const list = swatchList(html, 'color')
  if (!list) return []
  return [...list.matchAll(/<li class="color-swatch[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].flatMap((match) => {
    const path = /data-product-url="([^"]+)"/.exec(match[1]!)?.[1]
    const name = /\balt="([^"]+)"/.exec(match[1]!)?.[1]
    return path && name ? [{ name: colourName(decodeEntities(name)), url: decodeEntities(path) }] : []
  })
}

// ---------------------------------------------------------------------------
// One colour as a stored product
// ---------------------------------------------------------------------------

/**
 * Not a kind of thing: the site's top level, and the lists a product is
 * shown under (a slide reached from "Gifts Under $200" says so on its page).
 */
const NOT_A_KIND = /^(clothing|footwear|accessories|outlet|sale|gifts?\b.*|new arrivals|best[ -]?sellers|featured)$/i

/**
 * The product type: the most specific breadcrumb that names one kind of
 * thing, else the data layer's category. "Jackets & Coats" names two, and
 * would make every jacket a coat, so a jacket under it is left to its title.
 */
function kindOf(page: Pick<RoddAndGunnPage, 'crumbs' | 'type'>): string | null {
  const one = (name: string | null) => name !== null && !NOT_A_KIND.test(name) && !/&| and /i.test(name)
  return [...page.crumbs].reverse().find(one) ?? (one(page.type) ? page.type : null)
}

/** The site's size codes as the other shops write them: "SM" -> "S". "0" is the one size of a cap or a scarf. */
const SIZE_LABELS: Record<string, string> = { SM: 'S', ME: 'M', LG: 'L', '0': 'One size' }

function sizeLabel(label: string): string {
  return SIZE_LABELS[label.toUpperCase()] ?? label
}

/** "REGULAR" -> "Regular". */
function lengthLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase()
}

/** The id a colour is stored under: its Regular page when it has leg lengths, otherwise its only page. */
export function leadId(page: Pick<RoddAndGunnPage, 'id' | 'lengths'>): string {
  if (page.lengths.length === 0) return page.id
  const regular = page.lengths.find((length) => /^regular/i.test(length.label))
  return regular?.id ?? [...page.lengths.map((length) => length.id)].sort()[0]!
}

/**
 * One colour, from its page and the pages of its other leg lengths, as one
 * product: the lead page's words and photos, a variant per size per length,
 * each priced from its own page.
 */
export function normaliseRoddAndGunn(pages: RoddAndGunnPage[]): NormalisedProduct {
  const first = pages[0]
  if (!first) throw new RoddAndGunnPageError('no page to read')
  const lead = leadId(first)
  const main = pages.find((page) => page.id === lead) ?? first
  const order = first.lengths.map((length) => length.id)
  const sorted = [...pages].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))

  const title = main.name
  const productType = kindOf(main)
  const tags = [...new Set([main.category, ...main.crumbs].filter((tag): tag is string => Boolean(tag)))].sort((a, b) =>
    a.localeCompare(b),
  )
  const bodyHtml =
    [
      main.description ? `<p>${escapeHtml(main.description)}</p>` : '',
      main.notes.length > 0 ? `<ul>${main.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '',
    ].join('') || null
  const classification = classify({ title, productType, tags, vendor: VENDOR, catalogue: 'menswear' })
  const colour = main.colour ? colourName(main.colour) : null

  // By size, then length ("28 Short", "28 Regular", "28 Long", "30 Short"), so
  // a card listing the sizes in stock lists them in order.
  const ONE: RoddAndGunnSize = { code: 'ONE', label: 'One size', available: true }
  const sizesOf = (page: RoddAndGunnPage) => (page.sizes.length > 0 ? page.sizes : [ONE])
  const codes = [...new Set(sorted.flatMap((page) => sizesOf(page).map((size) => size.code)))]
  const variants = codes.flatMap((code) =>
    sorted.flatMap((page) => {
      const size = sizesOf(page).find((entry) => entry.code === code)
      if (!size) return []
      const length = page.lengths.length > 1 ? lengthLabel(page.lengths.find((entry) => entry.id === page.id)?.label ?? '') : ''
      const label = sizeLabel(size.label)
      const price = Math.round(page.price * 100)
      return [
        {
          external_id: `${page.id}-${size.code}`,
          title: [colour, label, length].filter(Boolean).join(' / '),
          option_size: label,
          option_colour: colour,
          sku: null,
          price_cents: price,
          compare_at_cents: page.was !== null ? Math.round(page.was * 100) : null,
          available: page.inStock && size.available && price > 0,
          size_key: sizeKey(label, classification.garment_type),
        } satisfies NormalisedVariant,
      ]
    }),
  )

  const images: ProductImage[] = main.images.map((src) => ({
    src,
    width: null,
    height: null,
    alt: colour ? `${title}, ${colour}` : title,
  }))

  return {
    external_id: lead,
    handle: lead,
    title,
    vendor: VENDOR,
    product_type: productType,
    tags,
    body_html: bodyHtml,
    url: main.url,
    images,
    variants,
    content_hash: contentHash({ title, vendor: VENDOR, productType, tags, bodyHtml, images, variants }),
    ...classification,
  }
}

// ---------------------------------------------------------------------------
// Reading a colour from the site
// ---------------------------------------------------------------------------

export type RoddAndGunnRead = {
  product: NormalisedProduct
  /** The page ids read for it: the colour and each of its other lengths. */
  pages: string[]
}

/** One page, or null when the site says it is gone (410 for a colour it no longer sells, 404). */
async function fetchPage(client: PoliteClient, url: string): Promise<RoddAndGunnPage | null> {
  let html: string
  try {
    html = await client.text(url)
  } catch (error) {
    if (error instanceof FetchError && (error.status === 404 || error.status === 410)) return null
    throw error
  }
  return readRoddAndGunnPage(html)
}

/**
 * Reads one colour: the page at the link, then the page of each other leg
 * length it comes in. Null when the site no longer has it; a length it no
 * longer has is left out, and its sizes count as gone.
 */
export async function fetchRoddAndGunn(
  client: PoliteClient,
  retailer: { base_url: string; currency: string },
  url: string,
): Promise<RoddAndGunnRead | null> {
  const first = await fetchPage(client, url)
  if (!first) return null
  const origin = new URL(retailer.base_url).origin
  const pages = [first]
  for (const length of first.lengths) {
    if (length.id === first.id) continue
    const page = await fetchPage(client, new URL(length.path, origin).toString())
    if (page) pages.push(page)
  }
  // The site picks its region by path, not by where the request comes from;
  // a page in another currency means that has changed.
  const foreign = pages.find((page) => page.currency !== retailer.currency)
  if (foreign) throw new RoddAndGunnPageError(`${foreign.id} is priced in ${foreign.currency}, not ${retailer.currency}`)
  return { product: normaliseRoddAndGunn(pages), pages: pages.map((page) => page.id) }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity
    }
    return NAMED[body.toLowerCase()] ?? entity
  })
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

/** Tags out, entities read, runs of space as one. */
function tidyText(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim()
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
