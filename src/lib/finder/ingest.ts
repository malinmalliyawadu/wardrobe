import type { Sql } from '../db.ts'
import type { Retailer } from '../retailers.ts'
import type { GarmentType } from '../wardrobe-values.ts'

import { classify, sizeKey } from './classify.ts'
import { DisallowedError, type PoliteClient } from './http.ts'
import { isAllowed } from './robots.ts'
import { normaliseProduct, shopifyPages, ShopifyProductSchema, type NormalisedProduct } from './shopify.ts'

/*
 * Stage 1: read every enabled store's feed into products, product_variants and
 * price_observations. Free and deterministic. A product's content hash says
 * whether it changed in a way the scorer would see; price and stock changes
 * land as observation rows instead. A store whose walk does not finish leaves
 * its removals alone, so a timeout never empties a catalogue.
 */

export type RetailerIngest = {
  slug: string
  status: 'ok' | 'disallowed' | 'failed'
  pages: number
  products: number
  menswear: number
  variants: number
  new: number
  changed: number
  removed: number
  skipped: number
  observations: number
  /** The feed reached Shopify's 25,000-product page limit; what lies past it is unreachable. */
  truncated: boolean
  seconds: number
  error?: string
}

type Log = (fields: Record<string, unknown>) => void

export async function ingestRetailer(
  sql: Sql,
  client: PoliteClient,
  retailer: Retailer,
  log: Log,
): Promise<RetailerIngest> {
  const started = Date.now()
  const startedAt = new Date()
  const stats: RetailerIngest = {
    slug: retailer.slug,
    status: 'ok',
    pages: 0,
    products: 0,
    menswear: 0,
    variants: 0,
    new: 0,
    changed: 0,
    removed: 0,
    skipped: 0,
    observations: 0,
    truncated: false,
    seconds: 0,
  }
  const feedOrigin = retailer.feed_url ?? retailer.base_url

  try {
    const robots = await client.robots(feedOrigin)
    const firstFeed = retailer.feed_collections[0] ? `/collections/${retailer.feed_collections[0]}/products.json` : '/products.json'
    const allowed = isAllowed(robots, `${firstFeed}?limit=250&page=1`)
    await sql`
      update retailers set robots_checked_at = now(), robots_allowed = ${allowed} where id = ${retailer.id}
    `
    if (!allowed) throw new DisallowedError(`robots.txt on ${new URL(feedOrigin).host} disallows ${firstFeed}`)

    // A store with a men's collection is read through it, and everything in it
    // counts as menswear; otherwise the whole catalogue, read per product.
    const feeds = retailer.feed_collections.length > 0
      ? retailer.feed_collections.map((handle) => `/collections/${handle}/products.json`)
      : ['/products.json']
    const catalogue = retailer.feed_collections.length > 0 ? 'menswear' : retailer.catalogue
    const seen = new Set<string>()

    for (const path of feeds) {
      for await (const page of shopifyPages(client, feedOrigin, path)) {
        if (page.truncated) {
          stats.truncated = true
          continue
        }
        const products: NormalisedProduct[] = []
        for (const raw of page.products) {
          const parsed = ShopifyProductSchema.safeParse(raw)
          if (!parsed.success) {
            stats.skipped += 1
            continue
          }
          // A product in two collections, or on two pages because the catalogue
          // shifted mid-walk, is written once.
          const product = normaliseProduct(parsed.data, { base_url: retailer.base_url, catalogue })
          if (seen.has(product.external_id)) continue
          seen.add(product.external_id)
          products.push(product)
        }
        const written = await writePage(sql, retailer.id, products)
        stats.pages += 1
        stats.products += products.length
        stats.menswear += products.filter((product) => product.menswear).length
        stats.variants += written.variants
        stats.new += written.new
        stats.changed += written.changed
        stats.observations += written.observations
        if (stats.pages % 10 === 0) log({ event: 'ingest.progress', retailer: retailer.slug, pages: stats.pages, products: stats.products })
      }
    }

    const removed = await sql<{ id: number }[]>`
      update products set removed_at = now()
      where retailer_id = ${retailer.id} and removed_at is null and last_seen_at < ${startedAt}
      returning id
    `
    stats.removed = removed.length
    await sql`update retailers set last_ingested_at = now() where id = ${retailer.id}`
  } catch (error) {
    stats.status = error instanceof DisallowedError ? 'disallowed' : 'failed'
    stats.error = (error as Error).message
  }
  stats.seconds = Math.round((Date.now() - started) / 1000)
  return stats
}

type ExistingProduct = { id: number; external_id: string; content_hash: string }
type ExistingVariant = { id: number; product_id: number; external_id: string; price_cents: number; available: boolean }

const VARIANT_CHUNK = 2000

/** One page in one transaction: products, then variants, then the observations for what moved. */
export async function writePage(
  sql: Sql,
  retailerId: number,
  products: NormalisedProduct[],
): Promise<{ new: number; changed: number; variants: number; observations: number }> {
  if (products.length === 0) return { new: 0, changed: 0, variants: 0, observations: 0 }

  return sql.begin(async (tx) => {
    const seenAt = new Date()
    const externalIds = products.map((product) => product.external_id)
    const before = new Map(
      (
        await tx<ExistingProduct[]>`
          select id::int as id, external_id, content_hash from products
          where retailer_id = ${retailerId} and external_id in ${tx(externalIds)}
        `
      ).map((row) => [row.external_id, row]),
    )

    const productRows = products.map((product) => ({
      retailer_id: retailerId,
      external_id: product.external_id,
      handle: product.handle,
      title: product.title,
      vendor: product.vendor,
      product_type: product.product_type,
      tags: product.tags,
      body_html: product.body_html,
      url: product.url,
      images: tx.json(product.images),
      menswear: product.menswear,
      garment_type: product.garment_type,
      garment_kind: product.garment_kind,
      content_hash: product.content_hash,
      last_seen_at: seenAt,
    }))

    const ids = await tx<{ id: number; external_id: string }[]>`
      insert into products ${tx(productRows)}
      on conflict (retailer_id, external_id) do update set
        handle = excluded.handle,
        title = excluded.title,
        vendor = excluded.vendor,
        product_type = excluded.product_type,
        tags = excluded.tags,
        body_html = excluded.body_html,
        url = excluded.url,
        images = excluded.images,
        menswear = excluded.menswear,
        garment_type = excluded.garment_type,
        garment_kind = excluded.garment_kind,
        content_hash = excluded.content_hash,
        last_seen_at = excluded.last_seen_at,
        removed_at = null
      returning id::int as id, external_id
    `
    const productId = new Map(ids.map((row) => [row.external_id, row.id]))

    let created = 0
    let changed = 0
    for (const product of products) {
      const previous = before.get(product.external_id)
      if (!previous) created += 1
      else if (previous.content_hash !== product.content_hash) changed += 1
    }

    const productIds = [...productId.values()]
    const variantsBefore = new Map(
      (
        await tx<ExistingVariant[]>`
          select id::int as id, product_id::int as product_id, external_id, price_cents, available
          from product_variants where product_id in ${tx(productIds)}
        `
      ).map((row) => [`${row.product_id}:${row.external_id}`, row]),
    )

    const variantRows = products.flatMap((product) => {
      const id = productId.get(product.external_id)!
      return product.variants.map((variant) => ({
        product_id: id,
        external_id: variant.external_id,
        title: variant.title,
        option_size: variant.option_size,
        option_colour: variant.option_colour,
        sku: variant.sku,
        price_cents: variant.price_cents,
        compare_at_cents: variant.compare_at_cents,
        available: variant.available,
        size_key: variant.size_key,
        last_seen_at: seenAt,
      }))
    })

    const observations: { variant_id: number; price_cents: number; available: boolean }[] = []
    for (let start = 0; start < variantRows.length; start += VARIANT_CHUNK) {
      const chunk = variantRows.slice(start, start + VARIANT_CHUNK)
      const written = await tx<{ id: number; product_id: number; external_id: string; price_cents: number; available: boolean }[]>`
        insert into product_variants ${tx(chunk)}
        on conflict (product_id, external_id) do update set
          title = excluded.title,
          option_size = excluded.option_size,
          option_colour = excluded.option_colour,
          sku = excluded.sku,
          price_cents = excluded.price_cents,
          compare_at_cents = excluded.compare_at_cents,
          available = excluded.available,
          size_key = excluded.size_key,
          last_seen_at = excluded.last_seen_at
        returning id::int as id, product_id::int as product_id, external_id, price_cents, available
      `
      for (const row of written) {
        const previous = variantsBefore.get(`${row.product_id}:${row.external_id}`)
        if (!previous || previous.price_cents !== row.price_cents || previous.available !== row.available) {
          observations.push({ variant_id: row.id, price_cents: row.price_cents, available: row.available })
        }
      }
    }

    // A size the store dropped from the product is out of stock, not deleted:
    // its price history stays.
    const gone = await tx<{ id: number; price_cents: number }[]>`
      update product_variants set available = false
      where product_id in ${tx(productIds)} and last_seen_at < ${seenAt} and available
      returning id::int as id, price_cents
    `
    for (const row of gone) observations.push({ variant_id: row.id, price_cents: row.price_cents, available: false })

    for (let start = 0; start < observations.length; start += VARIANT_CHUNK) {
      await tx`insert into price_observations ${tx(observations.slice(start, start + VARIANT_CHUNK))}`
    }

    return { new: created, changed, variants: variantRows.length, observations: observations.length }
  })
}

/**
 * Re-runs the classification rules over what is stored, without reading any
 * store: garment type, kind and menswear on products, the size key on their
 * variants. For trying a rule change against the real catalogue. The next
 * ingest would apply the same rules anyway.
 */
export async function reclassify(sql: Sql, retailers: Retailer[]): Promise<{ products: number; changed: number }> {
  let products = 0
  let changed = 0
  for (const retailer of retailers) {
    const catalogue = retailer.feed_collections.length > 0 ? 'menswear' : retailer.catalogue
    let after = 0
    for (;;) {
      const rows = await sql<
        { id: number; title: string; product_type: string | null; tags: string[]; vendor: string | null; menswear: boolean | null; garment_type: GarmentType | null; garment_kind: string | null }[]
      >`
        select id::int as id, title, product_type, tags, vendor, menswear, garment_type, garment_kind
        from products where retailer_id = ${retailer.id} and id > ${after} and removed_at is null
        order by id limit 2000
      `
      if (rows.length === 0) break
      after = rows.at(-1)!.id
      const updates = rows.flatMap((row) => {
        const next = classify({ title: row.title, productType: row.product_type, tags: row.tags, vendor: row.vendor, catalogue })
        const same = next.menswear === row.menswear && next.garment_type === row.garment_type && next.garment_kind === row.garment_kind
        return same ? [] : [{ id: row.id, ...next }]
      })
      products += rows.length
      changed += updates.length
      if (updates.length > 0) {
        await sql`
          update products p set menswear = u.menswear, garment_type = u.garment_type, garment_kind = u.garment_kind
          from jsonb_to_recordset(${sql.json(updates)}) as u(id bigint, menswear boolean, garment_type text, garment_kind text)
          where p.id = u.id
        `
      }
      const variants = await sql<{ id: number; option_size: string; garment_type: GarmentType | null; size_key: string | null }[]>`
        select v.id::int as id, v.option_size, p.garment_type, v.size_key
        from product_variants v join products p on p.id = v.product_id
        where p.id in ${sql(rows.map((row) => row.id))} and v.option_size is not null
      `
      const keys = variants.flatMap((variant) => {
        const key = sizeKey(variant.option_size, variant.garment_type)
        return key === variant.size_key ? [] : [{ id: variant.id, size_key: key }]
      })
      if (keys.length > 0) {
        await sql`
          update product_variants v set size_key = k.size_key
          from jsonb_to_recordset(${sql.json(keys)}) as k(id bigint, size_key text)
          where v.id = k.id
        `
      }
    }
  }
  return { products, changed }
}
