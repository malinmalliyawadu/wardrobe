import { createHash } from 'node:crypto'

import { z } from 'zod'

import type { Sql } from '../db.ts'
import { findPhotoSrc } from '../find-photos.ts'
import type { Retailer } from '../retailers.ts'
import { GARMENT_TYPES } from '../wardrobe-values.ts'

import { sizeKey } from './classify.ts'
import { writePage } from './ingest.ts'
import type { NormalisedProduct, ProductImage } from './shopify.ts'

/*
 * A find he adds by hand, from a store whose site cannot be read (platform
 * 'manual', migration 0012). What he types is stored as a product with one
 * variant, through the same writePage as the nightly walk, so Saved, slots,
 * try-ons and "Bought it" treat it like any find. Nothing reads it again: the
 * nightly refresh skips its store, and its price changes only when he adds
 * the same link again.
 */

export const ManualFindSchema = z.object({
  name: z.string().min(1).max(120),
  garment_type: z.enum(GARMENT_TYPES),
  /** In the store's own currency, as its page shows it. */
  price: z.number().positive('Enter the price').max(100_000),
  colour: z.string().max(60).nullable(),
  size: z.string().max(30).nullable(),
  /** The photo he chose (src/lib/find-photos.ts). Null keeps the one already on the find. */
  photo_id: z.number().int().positive().nullable(),
})

export type ManualFind = z.infer<typeof ManualFindSchema>

/**
 * One product per page and colour: the same link with the same colour is the
 * same find, so adding it again updates it, while another colour of it is a
 * find of its own, as the stores that are read list them. The query string is
 * left out (it carries tracking and the store's own colour codes); the link
 * as pasted is kept for opening the page.
 */
export function manualExternalId(url: URL, colour: string | null): string {
  const page = `${url.host.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`
  const shade = colour?.trim().toLowerCase().replace(/\s+/g, ' ')
  return shade ? `${page}#${shade}` : page
}

export function manualProduct(
  retailer: Pick<Retailer, 'name'>,
  url: URL,
  find: Omit<ManualFind, 'photo_id'>,
  image: ProductImage,
): NormalisedProduct {
  const title = find.name.trim()
  const colour = find.colour?.trim() || null
  const size = find.size?.trim() || null
  const priceCents = Math.round(find.price * 100)
  const external_id = manualExternalId(url, colour)
  const variant = {
    external_id: 'manual',
    title: [colour, size].filter(Boolean).join(' / ') || null,
    option_size: size,
    option_colour: colour,
    sku: null,
    price_cents: priceCents,
    compare_at_cents: null,
    available: true,
    size_key: size ? sizeKey(size, find.garment_type) : null,
  }
  const handle = url.pathname.split('/').filter(Boolean).at(-1) ?? external_id
  const product = {
    external_id,
    handle,
    title,
    vendor: retailer.name,
    product_type: null,
    tags: [],
    body_html: null,
    url: url.toString(),
    images: [image],
    variants: [variant],
    menswear: true,
    garment_type: find.garment_type,
    garment_kind: null,
  }
  const content_hash = createHash('sha256')
    .update(JSON.stringify([title, find.garment_type, colour, size, priceCents, image.src]))
    .digest('hex')
  return { ...product, content_hash }
}

export class ManualFindError extends Error {}

/** Stores what he typed for a find from a store that cannot be read. Returns the product's id. */
export async function addManualFind(sql: Sql, retailer: Retailer, url: URL, find: ManualFind): Promise<number> {
  const externalId = manualExternalId(url, find.colour)
  const [existing] = await sql<{ find_photo_id: number | null }[]>`
    select find_photo_id::int as find_photo_id from products
    where retailer_id = ${retailer.id} and external_id = ${externalId}
  `
  const photoId = find.photo_id ?? existing?.find_photo_id ?? null
  if (photoId === null) throw new ManualFindError('Add a photo of it')
  const [photo] = await sql<{ width: number; height: number }[]>`select width, height from find_photos where id = ${photoId}`
  if (!photo) throw new ManualFindError('That photo has gone. Choose it again.')

  const image: ProductImage = { src: findPhotoSrc(photoId), width: photo.width, height: photo.height, alt: null }
  const product = manualProduct(retailer, url, find, image)
  await writePage(sql, retailer.id, [product])
  // A new photo here is the find's photo, so it replaces any he chose for it since (src/lib/product-photos.ts).
  const [row] = await sql<{ id: number }[]>`
    update products set find_photo_id = ${photoId},
                        chosen_image = case when ${find.photo_id !== null} then null else chosen_image end
    where retailer_id = ${retailer.id} and external_id = ${product.external_id}
    returning id::int as id
  `
  if (!row) throw new Error('product insert returned nothing')
  return row.id
}
