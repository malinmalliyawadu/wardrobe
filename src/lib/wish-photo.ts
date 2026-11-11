import { createHash } from 'node:crypto'

import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { MODELS, callUsd, claude } from './claude.ts'
import { db, type Sql } from './db.ts'
import { findPhotoFile, findPhotoSrc, type FindPhoto } from './find-photos.ts'
import { writePage } from './finder/ingest.ts'
import type { NormalisedProduct, ProductImage } from './finder/shopify.ts'
import { PhotoError } from './photos.ts'
import { PHOTO_PLATFORM } from './retailers.ts'
import { finalText, plainDashes } from './structured.ts'
import { guideColours, type Guide } from './style-guide.ts'
import { GARMENT_TYPES, PIECE_GARMENT_TYPES } from './wardrobe-values.ts'

/*
 * A wish from a photo (migration 0025): something he saw, with no link to
 * it. The photo is stored like the photo of a find added by hand
 * (src/lib/find-photos.ts) and goes to Claude (Sonnet) once, as soon as he
 * chooses it, to fill in the form he then checks: the same agreement as a
 * photo of a piece of his (docs/plan.md 1.1). The wish is a product of the
 * hidden "From a photo" store, with one variant only when he gave a price.
 * Nothing reads it again, so its price is what he typed.
 */

// ---------------------------------------------------------------------------
// Claude's read
// ---------------------------------------------------------------------------

export const WishReadSchema = z.object({
  is_garment: z
    .boolean()
    .describe('False when the photo does not show a piece of menswear clearly enough to say what it is.'),
  name: z
    .string()
    .describe('What he would call it, colour first, under 6 words, no brand: "Ink navy merino crewneck".'),
  garment_type: z
    .enum(PIECE_GARMENT_TYPES)
    .describe('What it is as a garment, sport kit included: a gym tank is a tank, running shorts are shorts, training shoes are sneakers.'),
  palette_hex: z
    .string()
    .nullable()
    .describe('The hex of the palette colour this piece is, copied exactly from the list, when it is that colour or very close; null when it is none of them.'),
  shop: z
    .string()
    .nullable()
    .describe('The brand or shop, only when a label, logo or a shop page in the photo names it; otherwise null.'),
  price: z.number().nullable().describe('The price, only when the photo shows it (a screenshot of a shop page, a swing tag); otherwise null.'),
  currency: z
    .string()
    .nullable()
    .describe('The price\'s ISO currency code when the photo makes it clear ("NZD", "AUD", "USD"); null when it does not.'),
})

export type WishRead = z.infer<typeof WishReadSchema>

export class WishReadError extends Error {}

export const WISH_READ_SYSTEM_PROMPT = `You are an experienced menswear stylist keeping one client's wishlist. He has added a photo of one piece he wants: often a screenshot of a shop's page or of someone wearing it, sometimes a photo taken in a shop or of a stranger. Say what the piece is so he can find it again: its name, what kind of garment it is and its colour, and the brand and price when the photo shows them. Be accurate and plain rather than flattering.

When the photo shows a person in a whole outfit, describe the piece that is most clearly the subject, usually the one in the middle of the frame or the one a shop page is selling.

Colour matters most. Judge the garment's own colour, allowing for the light. When the colour is one of his palette colours, or close enough that he would call it that, give that hex exactly as listed; otherwise give null and let the name carry the colour.

When the photo does not show a piece of menswear (a room, a landscape, a pile of garments with none in particular), set is_garment to false and fill the rest as best you can.`

export function buildWishReadRequest(base64: string, guide: Pick<Guide, 'palette'> | null) {
  const palette = guide ? guideColours(guide).map((colour) => ({ hex: colour.hex, name: colour.name })) : []
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
    {
      type: 'text',
      text: palette.length
        ? `His palette (best colours and neutrals):\n${JSON.stringify(palette)}\n\nRead the piece in the photo.`
        : 'He has no palette yet, so palette_hex is null. Read the piece in the photo.',
    },
  ]
  // Without `parse`, the SDK passes the schema through and leaves the text alone.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parse: _parse, ...format } = zodOutputFormat(WishReadSchema)
  return {
    model: MODELS.piece,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: WISH_READ_SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content }],
    output_config: { effort: 'low' as const, format },
  }
}

/** One Sonnet call. The read and its cost are kept on the photo's row. */
export async function readWishPhoto(photo: FindPhoto, guide: Pick<Guide, 'palette'> | null, sql: Sql = db()): Promise<WishRead> {
  const bytes = await findPhotoFile(photo.id, 'master', sql)
  if (!bytes) throw new PhotoError('That photo is missing its file. Add it again.')
  const response = await claude().beta.messages.create(buildWishReadRequest(bytes.toString('base64'), guide), { maxRetries: 3 })
  const usd = callUsd(MODELS.piece, response.usage)
  const meta = {
    model: MODELS.piece,
    served_by: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    read_at: new Date().toISOString(),
  }

  let read: WishRead | null = null
  let failure: string | null = null
  if (response.stop_reason === 'refusal') failure = 'Claude declined to read that photo.'
  else if (response.stop_reason === 'max_tokens') failure = 'The read was cut off.'
  else {
    const parsed = WishReadSchema.safeParse(plainDashes(parseJson(finalText(response.content))))
    if (parsed.success) read = parsed.data
    else failure = 'Claude answered in a shape the app did not expect.'
  }
  await sql`
    update find_photos set read = ${sql.json({ ...(read ?? { failure }), meta })}, read_usd = ${usd}
    where id = ${photo.id}
  `
  if (!read) throw new WishReadError(failure ?? 'The read failed.')
  return read
}

/** What the form starts from. A price is only carried over in NZD, the one currency a wish from a photo is kept in. */
export type WishValues = { name: string; garment_type: string; price: string; shop: string; colour_hex: string }

export function wishValuesFromRead(read: WishRead | null, guide: Pick<Guide, 'palette'> | null): Partial<WishValues> {
  if (!read) return {}
  const named = read.palette_hex?.toLowerCase() ?? null
  const inGuide = named && guide && guideColours(guide).some((colour) => colour.hex === named) ? named : null
  const nzd = read.price !== null && read.price > 0 && read.currency?.toUpperCase() === 'NZD'
  return {
    name: sentence(read.name),
    garment_type: read.garment_type,
    price: nzd ? String(read.price) : '',
    shop: read.shop?.trim() ?? '',
    colour_hex: inGuide ?? '',
  }
}

function sentence(value: string): string {
  const trimmed = value.trim()
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// The wish as a product
// ---------------------------------------------------------------------------

export const PhotoWishSchema = z.object({
  photo_id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  garment_type: z.enum(GARMENT_TYPES),
  /** In NZD. Null when he does not know it. */
  price: z.number().positive().max(100_000).nullable(),
  /** The brand or shop, when he knows it. */
  shop: z.string().max(60).nullable(),
  /** The palette colour the read named, kept as the product's photo colour for "Bought it". */
  colour_hex: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .nullable(),
})

export type PhotoWish = z.infer<typeof PhotoWishSchema>

export class PhotoWishError extends Error {}

/** One wish per photo: adding the same photo again updates it. */
export function photoExternalId(photoId: number): string {
  return `photo-${photoId}`
}

export function photoProduct(wish: PhotoWish, image: ProductImage): NormalisedProduct {
  const title = wish.name.trim()
  const shop = wish.shop?.trim() || null
  const priceCents = wish.price === null ? null : Math.round(wish.price * 100)
  const external_id = photoExternalId(wish.photo_id)
  const product = {
    external_id,
    handle: external_id,
    title,
    vendor: shop,
    product_type: null,
    tags: [],
    body_html: null,
    url: image.src,
    images: [image],
    variants:
      priceCents === null
        ? []
        : [
            {
              external_id: 'photo',
              title: null,
              option_size: null,
              option_colour: null,
              sku: null,
              price_cents: priceCents,
              compare_at_cents: null,
              available: true,
              size_key: null,
            },
          ],
    menswear: true,
    garment_type: wish.garment_type,
    garment_kind: null,
  }
  const content_hash = createHash('sha256')
    .update(JSON.stringify([title, wish.garment_type, shop, priceCents, image.src]))
    .digest('hex')
  return { ...product, content_hash }
}

/** Stores a wish from a photo. Returns the product's id. */
export async function addPhotoWish(sql: Sql, wish: PhotoWish): Promise<number> {
  const [store] = await sql<{ id: number }[]>`select id::int as id from retailers where platform = ${PHOTO_PLATFORM}`
  if (!store) throw new Error('the From a photo store is missing; run the migrations')
  const [photo] = await sql<{ width: number; height: number }[]>`select width, height from find_photos where id = ${wish.photo_id}`
  if (!photo) throw new PhotoWishError('That photo has gone. Choose it again.')

  const image: ProductImage = { src: findPhotoSrc(wish.photo_id), width: photo.width, height: photo.height, alt: null }
  const product = photoProduct(wish, image)
  await writePage(sql, store.id, [product])
  const [row] = await sql<{ id: number }[]>`
    update products set find_photo_id = ${wish.photo_id},
                        image_colours = ${wish.colour_hex ? [wish.colour_hex] : null}
    where retailer_id = ${store.id} and external_id = ${product.external_id}
    returning id::int as id
  `
  if (!row) throw new Error('product insert returned nothing')
  return row.id
}
