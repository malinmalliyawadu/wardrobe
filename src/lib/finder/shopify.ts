import { createHash } from 'node:crypto'

import { z } from 'zod'

import { classify, sizeKey, type Classification } from './classify.ts'
import { FetchError, type PoliteClient } from './http.ts'

/*
 * The generic Shopify adapter. Every storefront serves its catalogue at
 * /products.json?limit=250&page=N without a key; the adapter walks the pages
 * until one comes back empty and turns each product into the normalised shape
 * the tables hold. It never decides what Malin sees: that is the filter's job.
 */

export const PAGE_SIZE = 250
/** 25,000 products at 250 a page is 100 pages; this is a guard against a feed that never ends. */
const MAX_PAGES = 400

const money = z.union([z.string(), z.number()]).nullable().optional()

const VariantSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().nullable().optional(),
  option1: z.string().nullable().optional(),
  option2: z.string().nullable().optional(),
  option3: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  price: money,
  compare_at_price: money,
  available: z.boolean().optional(),
})

const ImageSchema = z.object({
  src: z.string(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  alt: z.string().nullable().optional(),
})

const OptionSchema = z.object({
  name: z.string(),
  position: z.number().optional(),
  values: z.array(z.string()).optional(),
})

export const ShopifyProductSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  handle: z.string(),
  body_html: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  product_type: z.string().nullable().optional(),
  // Newer feeds give an array; some older themes a comma-separated string.
  tags: z.union([z.array(z.string()), z.string()]).nullable().optional(),
  variants: z.array(VariantSchema).default([]),
  images: z.array(ImageSchema).default([]),
  options: z.array(OptionSchema).default([]),
})

export const ShopifyPageSchema = z.object({ products: z.array(z.unknown()) })

export type ShopifyProduct = z.infer<typeof ShopifyProductSchema>

export type NormalisedVariant = {
  external_id: string
  title: string | null
  option_size: string | null
  option_colour: string | null
  sku: string | null
  price_cents: number
  compare_at_cents: number | null
  available: boolean
  size_key: string | null
}

export type ProductImage = { src: string; width: number | null; height: number | null; alt: string | null }

export type NormalisedProduct = {
  external_id: string
  handle: string
  title: string
  vendor: string | null
  product_type: string | null
  tags: string[]
  body_html: string | null
  url: string
  images: ProductImage[]
  variants: NormalisedVariant[]
  content_hash: string
} & Classification

const SIZE_OPTION = /\b(size|sizes|waist|shoe size)\b/i
const COLOUR_OPTION = /\b(colou?rs?|shade)\b/i

export function normaliseProduct(
  raw: ShopifyProduct,
  retailer: { base_url: string; catalogue: 'menswear' | 'mixed' },
): NormalisedProduct {
  const options = [...raw.options].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const colourIndex = options.findIndex((option) => COLOUR_OPTION.test(option.name))

  const tags = tidyTags(raw.tags)
  const title = raw.title.trim()
  const vendor = raw.vendor?.trim() || null
  const productType = raw.product_type?.trim() || null
  const bodyHtml = raw.body_html?.trim() || null

  const classification = classify({
    title,
    productType,
    tags,
    vendor,
    catalogue: retailer.catalogue,
  })
  const sizeIndex = findSizeOption(options, colourIndex, classification.garment_type)

  const variants = raw.variants.map((variant): NormalisedVariant => {
    const values = [variant.option1, variant.option2, variant.option3]
    const size = sizeIndex >= 0 ? clean(values[sizeIndex]) : ONE_SIZE
    const colour = colourIndex >= 0 ? clean(values[colourIndex]) : null
    const price = cents(variant.price) ?? 0
    const compareAt = cents(variant.compare_at_price)
    return {
      external_id: String(variant.id),
      title: clean(variant.title),
      option_size: size,
      option_colour: colour,
      sku: clean(variant.sku),
      price_cents: price,
      compare_at_cents: compareAt !== null && compareAt > price ? compareAt : null,
      // A price of zero is a placeholder (END. lists unreleased pieces at 0.00), not a free item.
      available: Boolean(variant.available) && price > 0,
      size_key: size === null ? null : sizeKey(size, classification.garment_type),
    }
  })

  const images = raw.images.map((image) => ({
    src: image.src,
    width: image.width ?? null,
    height: image.height ?? null,
    alt: clean(image.alt),
  }))

  return {
    external_id: String(raw.id),
    handle: raw.handle,
    title,
    vendor,
    product_type: productType,
    tags,
    body_html: bodyHtml,
    url: `${retailer.base_url}/products/${raw.handle}`,
    images,
    variants,
    content_hash: contentHash({ title, vendor, productType, tags, bodyHtml, images, variants }),
    ...classification,
  }
}

/**
 * What the scorer sees, and nothing else: words, pictures and the colours on
 * offer. Prices and stock are left out on purpose, so a sale or a size
 * selling out never pays for a second score; the filter reads those fresh
 * every night instead. Image URLs are hashed without their ?v= cache-buster.
 */
export function contentHash(product: {
  title: string
  vendor: string | null
  productType: string | null
  tags: string[]
  bodyHtml: string | null
  images: ProductImage[]
  variants: Pick<NormalisedVariant, 'option_colour'>[]
}): string {
  const colours = [...new Set(product.variants.map((variant) => variant.option_colour).filter(Boolean))].sort()
  const material = JSON.stringify([
    product.title,
    product.vendor,
    product.productType,
    product.tags,
    product.bodyHtml,
    product.images.map((image) => image.src.split('?')[0]),
    colours,
  ])
  return createHash('sha256').update(material).digest('hex').slice(0, 32)
}

/**
 * Shopify serves page-based pagination up to 25,000 products (page 100 at 250
 * a page) and answers the page after with a 400. A feed that reaches it ends
 * there, and the walk says it was truncated.
 */
export const PAGE_LIMIT_PRODUCTS = 25_000

/**
 * Walks a feed's pages: "/products.json" for a whole store, or
 * "/collections/<handle>/products.json" for one collection. Yields each page's
 * products as they arrive, so memory stays flat.
 */
export async function* shopifyPages(
  client: PoliteClient,
  feedOrigin: string,
  path = '/products.json',
): AsyncGenerator<{ page: number; products: unknown[]; truncated: boolean }> {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let body: unknown
    try {
      body = await client.json(`${feedOrigin}${path}?limit=${PAGE_SIZE}&page=${page}`)
    } catch (error) {
      const atLimit = (page - 1) * PAGE_SIZE >= PAGE_LIMIT_PRODUCTS
      if (atLimit && error instanceof FetchError && error.status === 400) {
        yield { page, products: [], truncated: true }
        return
      }
      throw error
    }
    const parsed = ShopifyPageSchema.safeParse(body)
    if (!parsed.success) throw new Error(`${feedOrigin}${path} page ${page} is not a Shopify products page`)
    if (parsed.data.products.length === 0) return
    yield { page, products: parsed.data.products, truncated: false }
    if (parsed.data.products.length < PAGE_SIZE) return
  }
  throw new Error(`${feedOrigin}${path} still had products after ${MAX_PAGES} pages; stopped`)
}


function tidyTags(tags: ShopifyProduct['tags']): string[] {
  const list = Array.isArray(tags) ? tags : (tags ?? '').split(',')
  return [...new Set(list.map((tag) => tag.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const ONE_SIZE = 'One size'

/**
 * The option named size, or failing that one whose values read as sizes (a
 * store that calls it "Title" or "Fit"). No such option means one size.
 */
function findSizeOption(
  options: z.infer<typeof OptionSchema>[],
  colourIndex: number,
  garment: Classification['garment_type'],
): number {
  const named = options.findIndex((option) => SIZE_OPTION.test(option.name))
  if (named >= 0) return named
  return options.findIndex((option, index) => {
    if (index === colourIndex) return false
    const values = option.values ?? []
    const sized = values.filter((value) => {
      const key = sizeKey(value, garment)
      return key !== null && key !== 'ONE'
    })
    return values.length > 0 && sized.length * 2 >= values.length
  })
}

export function cents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.round(number * 100)
}
