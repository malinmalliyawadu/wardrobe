import { z } from 'zod'

import type { Sql } from '../db.ts'
import type { Retailer } from '../retailers.ts'

import { DisallowedError, FetchError, type PoliteClient } from './http.ts'
import { writePage } from './ingest.ts'
import { normaliseProduct, ShopifyProductSchema, type NormalisedProduct, type ShopifyProduct } from './shopify.ts'
import {
  chooseColour,
  fetchUniqloProduct,
  normaliseUniqlo,
  parseUniqloHandle,
  parseUniqloLink,
  UniqloPageError,
  uniqloHandle,
} from './uniqlo.ts'

/*
 * A product Malin pastes a link to, rather than one the finder found. Any
 * product page on one of the stores, read through the same polite client as
 * the nightly walk and stored like any other product, so the nightly run
 * keeps its price and stock current. A Shopify store's product is read from
 * its own /products/<handle>.js (the per-product endpoint every Shopify theme
 * serves, with stock per size); Uniqlo's from its product page (uniqlo.ts).
 */

export class ProductLinkError extends Error {}

/** A pasted link as a URL, or the reason it is not one. */
export function parseLink(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new ProductLinkError('That is not a link. Paste the address of a product page.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProductLinkError('That is not a web link. Paste the address of a product page.')
  }
  return url
}

const NOT_A_PRODUCT = 'That is not a product page. Open the product itself and copy its address.'

/** "https://www.countryroad.co.nz/en-nz/collections/man/products/longline-short-60322146?variant=1" -> its host and handle. */
export function parseProductLink(input: string): { host: string; handle: string } {
  const url = parseLink(input)
  const match = /\/products\/([a-z0-9][a-z0-9-]*)(?:\.(?:js|json))?\/?$/i.exec(url.pathname)
  if (!match) throw new ProductLinkError(NOT_A_PRODUCT)
  return { host: bareHost(url.host), handle: match[1]!.toLowerCase() }
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/** The store a link belongs to: its public site or the host its feed is read from. */
export function retailerForHost<T extends Pick<Retailer, 'base_url' | 'feed_url'>>(retailers: T[], host: string): T | null {
  return (
    retailers.find((retailer) =>
      [retailer.base_url, retailer.feed_url].some((origin) => origin && bareHost(new URL(origin).host) === host),
    ) ?? null
  )
}

/** The per-product endpoint's shape: prices in cents, images as bare URLs, "type" and "description". */
const JsProductSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  handle: z.string(),
  description: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  options: z
    .array(z.union([z.object({ name: z.string(), position: z.number().optional(), values: z.array(z.string()).optional() }), z.string()]))
    .default([]),
  images: z.array(z.string()).default([]),
  variants: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]),
        title: z.string().nullable().optional(),
        option1: z.string().nullable().optional(),
        option2: z.string().nullable().optional(),
        option3: z.string().nullable().optional(),
        sku: z.string().nullable().optional(),
        price: z.number(),
        compare_at_price: z.number().nullable().optional(),
        available: z.boolean().optional(),
      }),
    )
    .default([]),
})

/** The .js shape as the adapter's products.json shape, so the rest of the pipeline sees one kind of product. */
export function fromProductJs(raw: unknown): ShopifyProduct {
  const product = JsProductSchema.parse(raw)
  return ShopifyProductSchema.parse({
    id: product.id,
    title: product.title,
    handle: product.handle,
    body_html: product.description ?? null,
    vendor: product.vendor ?? null,
    product_type: product.type ?? null,
    tags: product.tags,
    options: product.options.map((option, index) =>
      typeof option === 'string' ? { name: option, position: index + 1 } : option,
    ),
    images: product.images.map((src) => ({ src: src.startsWith('//') ? `https:${src}` : src })),
    variants: product.variants.map((variant) => ({
      ...variant,
      price: (variant.price / 100).toFixed(2),
      compare_at_price: variant.compare_at_price ? (variant.compare_at_price / 100).toFixed(2) : null,
    })),
  })
}

/** Reads one product from its store, ready to store. Null when the store says it no longer exists. */
export async function fetchProduct(client: PoliteClient, retailer: Retailer, handle: string): Promise<NormalisedProduct | null> {
  try {
    if (retailer.platform === 'uniqlo') return await fetchUniqlo(client, retailer, handle)
    const origin = retailer.feed_url ?? retailer.base_url
    const raw = fromProductJs(await client.json(`${origin}/products/${handle}.js`))
    return normaliseProduct(raw, { base_url: retailer.base_url, catalogue: storedCatalogue(retailer) })
  } catch (error) {
    if (error instanceof FetchError && error.status === 404) return null
    if (error instanceof DisallowedError) {
      throw new ProductLinkError(`${retailer.name} does not allow its product pages to be read automatically.`)
    }
    if (error instanceof z.ZodError || error instanceof UniqloPageError) {
      throw new ProductLinkError(`${retailer.name} answered with something that is not a product.`)
    }
    throw error
  }
}

/**
 * One colour of a Uniqlo product. A stored handle names its colour; a pasted
 * link may not, which is fine when there is only one. A colour Uniqlo no
 * longer lists is gone, like a product it no longer has.
 */
async function fetchUniqlo(client: PoliteClient, retailer: Retailer, handle: string): Promise<NormalisedProduct | null> {
  const link = parseUniqloHandle(handle)
  if (!link) throw new UniqloPageError(`not a Uniqlo handle: ${handle}`)
  const product = await fetchUniqloProduct(client, retailer.base_url, link)
  if (!product) return null
  const chosen = chooseColour(product, link.colour)
  if ('missing' in chosen) {
    if (chosen.missing === 'gone') return null
    throw new ProductLinkError(
      `Uniqlo sells it in ${listed(chosen.choices)}. Choose yours on Uniqlo’s page, then copy the link again.`,
    )
  }
  return normaliseUniqlo(product, chosen.colour, retailer)
}

function listed(words: string[]): string {
  const lower = words.map((word) => word.toLowerCase())
  return lower.length <= 1 ? (lower[0] ?? 'several colours') : `${lower.slice(0, -1).join(', ')} and ${lower.at(-1)}`
}

/** The handle fetchProduct takes for a pasted link: the Shopify handle, or the Uniqlo product and colour. */
function handleForLink(retailer: Retailer, url: URL): string {
  if (retailer.platform === 'uniqlo') {
    const link = parseUniqloLink(url)
    if (!link) throw new ProductLinkError(NOT_A_PRODUCT)
    return uniqloHandle(link)
  }
  return parseProductLink(url.toString()).handle
}

/** Reads a pasted link's product and stores it. Returns the product's id. */
export async function addProductFromLink(
  sql: Sql,
  client: PoliteClient,
  retailers: Retailer[],
  link: string,
): Promise<{ productId: number; title: string; retailer: string }> {
  const url = parseLink(link)
  const host = bareHost(url.host)
  const retailer = retailerForHost(retailers, host)
  if (!retailer) {
    const names = retailers.map((store) => store.name).join(', ')
    throw new ProductLinkError(`Wardrobe can only read the shops it knows: ${names}. That link is from ${host}.`)
  }
  const handle = handleForLink(retailer, url)
  let product: NormalisedProduct | null
  try {
    product = await fetchProduct(client, retailer, handle)
  } catch (error) {
    if (error instanceof ProductLinkError) throw error
    throw new ProductLinkError(`${retailer.name} did not answer. Try again in a minute.`)
  }
  if (!product) throw new ProductLinkError(`${retailer.name} has no product at that link any more.`)
  await writePage(sql, retailer.id, [product])
  const [row] = await sql<{ id: number }[]>`
    select id::int as id from products where retailer_id = ${retailer.id} and external_id = ${product.external_id}
  `
  if (!row) throw new Error('product insert returned nothing')
  return { productId: row.id, title: product.title, retailer: retailer.name }
}

/** How the nightly walk reads a store, so a linked product is classified the way the walk would. */
export function storedCatalogue(retailer: Pick<Retailer, 'feed_collections' | 'catalogue'>): 'menswear' | 'mixed' {
  return retailer.feed_collections.length > 0 ? 'menswear' : retailer.catalogue
}

/**
 * Saved products the night's walk did not see (a linked product outside the
 * men's collection, or one the store has delisted) are read one by one, so
 * their price and stock stay current; one the store no longer has is marked
 * removed. Stores switched off too: a link he pasted from one is still
 * something he is watching, and it is a handful of requests.
 */
export async function refreshSaved(
  sql: Sql,
  client: PoliteClient,
  retailers: Retailer[],
  since: Date,
): Promise<{ checked: number; removed: number; failed: number }> {
  const byId = new Map(retailers.map((retailer) => [retailer.id, retailer]))
  const stale = await sql<{ id: number; retailer_id: number; handle: string | null }[]>`
    with latest as (
      select distinct on (product_id) product_id, action
      from feed_actions order by product_id, created_at desc, id desc
    )
    select p.id::int as id, p.retailer_id::int as retailer_id, p.handle
    from latest l join products p on p.id = l.product_id
    where l.action = 'saved' and p.last_seen_at < ${since}
  `
  const stats = { checked: 0, removed: 0, failed: 0 }
  for (const row of stale) {
    const retailer = byId.get(row.retailer_id)
    if (!retailer || !row.handle) continue
    try {
      const product = await fetchProduct(client, retailer, row.handle)
      stats.checked += 1
      if (!product) {
        await sql.begin(async (tx) => {
          await tx`update products set removed_at = coalesce(removed_at, now()) where id = ${row.id}`
          // Each size it still had is now out, and recorded so, so Saved can say when it went.
          const gone = await tx<{ variant_id: number; price_cents: number }[]>`
            update product_variants set available = false where product_id = ${row.id} and available
            returning id::int as variant_id, price_cents
          `
          if (gone.length > 0) {
            await tx`insert into price_observations ${tx(gone.map((variant) => ({ ...variant, available: false })))}`
          }
        })
        stats.removed += 1
        continue
      }
      await writePage(sql, retailer.id, [product])
    } catch {
      stats.failed += 1
    }
  }
  return stats
}
