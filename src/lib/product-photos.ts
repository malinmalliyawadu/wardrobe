import { db, type Sql } from './db.ts'
import { findPhoto, findPhotoId, findPhotoSrc, storeFindPhoto } from './find-photos.ts'
import type { ProductImage } from './finder/shopify.ts'

/*
 * The photo a product shows (migration 0020). A shop's first photo is not
 * always the one to judge it by or to try it on from, so when he pastes a
 * link he can pick another of the shop's photos or add his own. The choice is
 * products.chosen_image, which the nightly walk never touches; main_image is
 * what every page and try-on reads. Choosing the shop's first photo clears
 * the choice, so the product follows the shop again.
 *
 * His own photo is a find photo (src/lib/find-photos.ts): stored in the
 * photo store, served at /photos/finds/:id, and kept from the orphan sweep
 * while a product shows it.
 */

export class ProductPhotoError extends Error {}

/** The photos he can choose from: the shop's, then his own when it is the one shown. */
export function photoChoices(images: ProductImage[], shown: ProductImage | null): ProductImage[] {
  if (!shown || images.some((image) => image.src === shown.src)) return images
  return [...images, shown]
}

export type ProductPhotos = {
  product_id: number
  title: string
  photos: ProductImage[]
  /** The src of the photo it shows now. */
  shown: string | null
}

export async function productPhotos(productId: number, sql: Sql = db()): Promise<ProductPhotos | null> {
  const [row] = await sql<{ title: string; images: ProductImage[]; main_image: ProductImage | null }[]>`
    select title, images, main_image from products where id = ${productId}
  `
  if (!row) return null
  return {
    product_id: productId,
    title: row.title,
    photos: photoChoices(row.images, row.main_image),
    shown: row.main_image?.src ?? null,
  }
}

/**
 * Makes one photo the one a product shows: one of the shop's, or one of his
 * own find photos. Returns the photo it now shows.
 */
export async function chooseProductPhoto(productId: number, src: string, sql: Sql = db()): Promise<ProductImage> {
  const [product] = await sql<{ images: ProductImage[] }[]>`select images from products where id = ${productId}`
  if (!product) throw new ProductPhotoError('That find has gone.')

  let chosen: ProductImage | null
  const own = findPhotoId(src)
  if (own !== null) {
    const photo = await findPhoto(own, sql)
    if (!photo) throw new ProductPhotoError('That photo has gone. Add it again.')
    chosen = { src: findPhotoSrc(photo.id), width: photo.width, height: photo.height, alt: null }
  } else {
    const index = product.images.findIndex((image) => image.src === src)
    if (index < 0) throw new ProductPhotoError('That is not one of its photos any more.')
    // The shop's first photo is no choice at all: it follows the shop again.
    chosen = index === 0 ? null : product.images[index]!
  }

  const [row] = await sql<{ main_image: ProductImage }[]>`
    update products set chosen_image = ${chosen === null ? null : sql.json(chosen)}
    where id = ${productId}
    returning main_image
  `
  return row!.main_image
}

/** Stores a photo of his and makes it the one the product shows. */
export async function addOwnProductPhoto(
  productId: number,
  input: { bytes: Buffer; mime: string },
  sql: Sql = db(),
): Promise<ProductImage> {
  const [product] = await sql`select 1 from products where id = ${productId}`
  if (!product) throw new ProductPhotoError('That find has gone.')
  const photo = await storeFindPhoto(input, sql)
  return chooseProductPhoto(productId, findPhotoSrc(photo.id), sql)
}
