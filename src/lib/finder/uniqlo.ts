import { z } from 'zod'

import { classify, sizeKey } from './classify.ts'
import { colourName } from './colour.ts'
import { FetchError, type PoliteClient } from './http.ts'
import { contentHash, type NormalisedProduct, type NormalisedVariant, type ProductImage } from './shopify.ts'

/*
 * Uniqlo, read one product at a time from a link Malin pastes. Uniqlo has no
 * NZ online store, so its site is never walked; a link exists to add a piece
 * he owns (or one he means to buy on a trip) with its photo and details.
 *
 * The product page is server-rendered with the whole product in
 * window.__PRELOADED_STATE__: name, the gender and category it sits under,
 * colours, sizes, lengths, price (a sale price beside the usual one),
 * composition and photos per colour. Per-size stock is not in it (the page
 * asks for that from the browser), so every size of a colour on sale counts
 * as available, and Saved cannot say when a size sells out. The price is one
 * for the whole product: when some sizes or colours are marked down, the sale
 * price is the lowest of them, the "from" price the page itself shows.
 *
 * Uniqlo sells each colour of a product under one page; the wardrobe needs
 * the colour he has, with its own photo, so each colour is stored as its own
 * product, the way Country Road lists them. A link names its colour as
 * ?colorDisplayCode=09; one that names none is fine for a product sold in one
 * colour, and otherwise has to say which.
 *
 * Each region with a store in data/retailers.json (Uniqlo AU, Uniqlo US) is
 * its own retailer, in its own currency, since a product or colour sold in one
 * region is often missing from another. A link is read from its own region's
 * store (retailerForLink); one from a region with no store here
 * (uniqlo.com/uk/en/..., /jp/ja/...) is read from Uniqlo AU's page for the
 * same product id.
 */

/** "/au/en/products/E475296-000/00" -> the product id and price group. */
const PRODUCT_PATH = /^\/[a-z]{2}\/[a-z]{2}\/products\/([a-z]\d{6}-\d{3})\/(\d{2})\/?$/i
/** The handle for one colour, "E475296-000/00/09", or for a link that names none, "E475296-000/00". */
const HANDLE = /^([A-Z]\d{6}-\d{3})\/(\d{2})(?:\/([A-Z0-9]{2,3}))?$/

export type UniqloLink = { productId: string; priceGroup: string; colour: string | null }

/** The product a Uniqlo page link is for, or null when the path is not a product page. */
export function parseUniqloLink(url: URL): UniqloLink | null {
  const match = PRODUCT_PATH.exec(url.pathname)
  if (!match) return null
  const colour = url.searchParams.get('colorDisplayCode')?.trim().toUpperCase() || null
  return { productId: match[1]!.toUpperCase(), priceGroup: match[2]!, colour: colour && /^[A-Z0-9]{2,3}$/.test(colour) ? colour : null }
}

export function uniqloHandle(link: UniqloLink): string {
  return [link.productId, link.priceGroup, link.colour].filter(Boolean).join('/')
}

/** A handle back to its link, or null for one this module did not write. */
export function parseUniqloHandle(handle: string): UniqloLink | null {
  const match = HANDLE.exec(handle)
  return match ? { productId: match[1]!, priceGroup: match[2]!, colour: match[3] ?? null } : null
}

/** The product page for one colour, on the store's own region. */
export function uniqloPageUrl(baseUrl: string, link: UniqloLink): string {
  const page = `${baseUrl}/products/${link.productId}/${link.priceGroup}`
  return link.colour ? `${page}?colorDisplayCode=${link.colour}` : page
}

// ---------------------------------------------------------------------------
// The page's product
// ---------------------------------------------------------------------------

const Named = z.object({ displayCode: z.string(), name: z.string() })
const Price = z.object({ value: z.number(), currency: z.object({ code: z.string() }).optional() }).nullable().optional()
const Crumb = z.object({ locale: z.string() }).nullable().optional()

export const UniqloProductSchema = z.object({
  productId: z.string(),
  priceGroup: z.string(),
  name: z.string(),
  l1Ids: z.array(z.string()).default([]),
  genderName: z.string().nullable().optional(),
  breadcrumbs: z
    .object({ gender: Crumb, class: Crumb, category: Crumb, subcategory: Crumb })
    .partial()
    .default({}),
  colors: z.array(Named).default([]),
  sizes: z.array(Named).default([]),
  plds: z.array(Named).default([]),
  prices: z.object({ base: Price, promo: Price }),
  composition: z.string().nullable().optional(),
  longDescription: z.string().nullable().optional(),
  designDetail: z.string().nullable().optional(),
  tags: z.array(z.object({ tagName: z.string(), display: z.boolean().optional() })).default([]),
  // A shot can be a video ({ video: "...mp4" }, no image); those are left out.
  images: z
    .object({
      main: z.record(z.string(), z.object({ image: z.string().optional() })).default({}),
      sub: z.array(z.object({ image: z.string().optional(), colorCode: z.string().nullable().optional() })).default([]),
    })
    .default({ main: {}, sub: [] }),
  productLifeCycleData: z.object({ isDiscontinuedProduct: z.boolean().optional() }).nullable().optional(),
})

export type UniqloProduct = z.infer<typeof UniqloProductSchema>

export class UniqloPageError extends Error {}

const STATE = 'window.__PRELOADED_STATE__'

/** The product in a product page's preloaded state. Null when the page has none (Uniqlo's "not found" page). */
export function readUniqloPage(html: string): UniqloProduct | null {
  const start = html.indexOf(STATE)
  if (start < 0) throw new UniqloPageError('the page has no preloaded state')
  const end = html.indexOf('</script>', start)
  const source = html
    .slice(start + STATE.length, end < 0 ? undefined : end)
    .replace(/^\s*=\s*/, '')
    .replace(/;\s*$/, '')
  let state: unknown
  try {
    state = JSON.parse(source)
  } catch {
    throw new UniqloPageError('the preloaded state is not JSON')
  }
  const entities = z
    .object({ entity: z.object({ pdpEntity: z.record(z.string(), z.object({ product: z.unknown() })).nullable().default({}) }) })
    .safeParse(state)
  if (!entities.success) throw new UniqloPageError('the preloaded state has no product entities')
  const [entry] = Object.values(entities.data.entity.pdpEntity ?? {})
  if (!entry?.product) return null
  const product = UniqloProductSchema.safeParse(entry.product)
  if (!product.success) throw new UniqloPageError('the page’s product is not in the shape it was')
  return product.data
}

/** Reads one product's page. Null when Uniqlo says it no longer exists. */
export async function fetchUniqloProduct(client: PoliteClient, baseUrl: string, link: UniqloLink): Promise<UniqloProduct | null> {
  let html: string
  try {
    html = await client.text(uniqloPageUrl(baseUrl, link))
  } catch (error) {
    if (error instanceof FetchError && error.status === 404) return null
    throw error
  }
  return readUniqloPage(html)
}

// ---------------------------------------------------------------------------
// One colour as a stored product
// ---------------------------------------------------------------------------

/** The colour a link stands for: the one it names, or the only one there is. */
export function chooseColour(product: UniqloProduct, requested: string | null): { colour: string } | { missing: 'unnamed' | 'gone'; choices: string[] } {
  const choices = product.colors.map((colour) => colourName(colour.name))
  if (requested) {
    return product.colors.some((colour) => colour.displayCode === requested) ? { colour: requested } : { missing: 'gone', choices }
  }
  if (product.colors.length === 1) return { colour: product.colors[0]!.displayCode }
  return { missing: 'unnamed', choices }
}

const NO_LENGTH = '000'

export function normaliseUniqlo(
  product: UniqloProduct,
  colourCode: string,
  retailer: { base_url: string },
): NormalisedProduct {
  const colour = product.colors.find((entry) => entry.displayCode === colourCode)
  if (!colour) throw new UniqloPageError(`the product has no colour ${colourCode}`)
  const colourLabel = colourName(colour.name)

  const title = product.name.trim()
  const vendor = 'Uniqlo'
  const crumbs = product.breadcrumbs
  const productType = crumbs.category?.locale?.trim() || null
  const tags = [
    ...new Set(
      [
        product.genderName,
        crumbs.class?.locale,
        crumbs.subcategory?.locale,
        ...product.tags.filter((tag) => tag.display !== false).map((tag) => tag.tagName),
      ]
        .map((tag) => tag?.trim())
        .filter((tag): tag is string => Boolean(tag)),
    ),
  ].sort((a, b) => a.localeCompare(b))
  const bodyHtml =
    [product.longDescription, product.designDetail, product.composition ? `- Fabric: ${product.composition}` : null]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join('<br>') || null

  // Uniqlo's own gender is the menswear rule's best evidence; the title never says.
  const classification = classify({ title, productType, tags, vendor, catalogue: 'mixed' })

  const promo = product.prices.promo?.value ?? null
  const base = product.prices.base?.value ?? null
  const price = Math.round((promo ?? base ?? 0) * 100)
  const compareAt = promo !== null && base !== null && base > promo ? Math.round(base * 100) : null
  const onSale = product.productLifeCycleData?.isDiscontinuedProduct !== true && price > 0

  const item = product.l1Ids[0] ?? product.productId
  const lengths = product.plds.filter((pld) => pld.displayCode !== NO_LENGTH)
  const variants = product.sizes.flatMap((size) =>
    (lengths.length > 0 ? lengths : [null]).map((length): NormalisedVariant => {
      const label = size.name.trim()
      return {
        external_id: `${item}-${colourCode}-${size.displayCode}-${length?.displayCode ?? NO_LENGTH}`,
        title: [colourLabel, label, length?.name.trim()].filter(Boolean).join(' / '),
        option_size: label,
        option_colour: colourLabel,
        sku: null,
        price_cents: price,
        compare_at_cents: compareAt,
        available: onSale,
        size_key: sizeKey(label, classification.garment_type),
      }
    }),
  )

  // The colour's own photo first, then the extra shots of that colour (a
  // model wearing another colour is left out, and so is a video).
  const images: ProductImage[] = [
    product.images.main[colourCode]?.image,
    ...product.images.sub.filter((sub) => sub.colorCode === colourCode).map((sub) => sub.image),
  ]
    .filter((src): src is string => Boolean(src))
    .map((src) => ({ src, width: null, height: null, alt: `${title}, ${colourLabel}` }))

  const link = { productId: product.productId, priceGroup: product.priceGroup, colour: colourCode }
  return {
    external_id: `${product.productId}-${product.priceGroup}-${colourCode}`,
    handle: uniqloHandle(link),
    title,
    vendor,
    product_type: productType,
    tags,
    body_html: bodyHtml,
    url: uniqloPageUrl(retailer.base_url, link),
    images,
    variants,
    content_hash: contentHash({ title, vendor, productType, tags, bodyHtml, images, variants }),
    ...classification,
  }
}
