import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { MODELS, callUsd, claude } from './claude.ts'
import { db, type Sql } from './db.ts'
import { findPhotoId } from './find-photos.ts'
import { plainText } from './finder/score.ts'
import { productImageAt } from './product-image.ts'
import { FITS, type Fit } from './profile-values.ts'
import { finalText, plainDashes } from './structured.ts'

/*
 * A find's cut, in words an image editor can follow. Told only to let a
 * garment "fit the way that cut would", the try-on editor fits it to his
 * body: Bronze Snake's Phillip overshirt, shot a size up on a slim model and
 * plainly oversized, came back a regular fit (2026-11-07). Neither its title
 * nor its listing says "oversized"; the photo does, against the model's
 * frame. So before a try-on with a find is made, Sonnet reads the shop's
 * photo and listing once and says where the seams sit, how much room there
 * is and where it ends, and the try-on prompt carries that.
 *
 * Kept per product and photo (product_cuts), so a find is read once whatever
 * asks for its picture. Only a shop's photo is read, by URL as the nightly
 * scorer reads it: his own photo of a find goes nowhere but the try-on editor
 * (docs/plan.md 1.1), so a find shown by it keeps the prompt's general line.
 * Shoes, belts, bags and accessories have no cut to speak of and are not read.
 */

const IMAGE_WIDTH = 1024
const CALL_TIMEOUT_MS = 60_000

/** The garment types whose cut is not read. */
const UNCUT = new Set(['shoes', 'boots', 'sneakers', 'belt', 'bag', 'accessory'])

export type Cut = { fit: Fit | null; silhouette: string }

/** What the read is given: the photo the try-on sends, and the listing. */
export type CutListing = {
  product_id: number
  image: string
  title: string
  garment_type: string | null
  body_html: string | null
  tags: string[]
}

/** A read, with what it cost. */
export type CutRead = {
  cut: Cut
  model: string
  served_by: string | null
  input_tokens: number | null
  output_tokens: number | null
  usd: number | null
}

/** Reads one listing's cut, or answers null when it cannot. The tests' seam. */
export type CutReader = (listing: CutListing) => Promise<CutRead | null>

/** Whether a find shown by this photo has its cut read: a garment, and a shop's photo. */
export function readsCut(garmentType: string | null, image: string): boolean {
  return !UNCUT.has(garmentType ?? '') && findPhotoId(image) === null
}

export const CutSchema = z.object({
  fit: z
    .enum(FITS)
    .nullable()
    .describe(
      'The cut as photographed, judged from the garment against the model: slim (close to the body), regular (follows the body with ordinary ease), relaxed (easy room, a slightly dropped shoulder), oversized (shoulder seams well down the arm, a wide body, extra length). Null when the photo cannot show it.',
    ),
  silhouette: z
    .string()
    .describe(
      'One or two sentences, under 50 words, of positions an image editor can draw, measured against the wearer. For a top or layer: where the shoulder seams sit against the shoulder point, the room in the body and sleeves, where the sleeves end, where the hem falls, how it hangs. For trousers: the rise, the room in the seat and thigh, the taper, the length and break. No colour, no style words, no praise.',
    ),
})

export const CUT_SYSTEM_PROMPT = `You are a menswear fit technician. A private app is about to ask an image editor to put this garment on one man from a photo of him. Told only the garment's name, the editor fits every garment close to his body, so an oversized shirt comes back a regular one. Describe the garment's cut so the editor can draw it on a different man exactly as it is cut.

Judge from the photo, against the model's body: where the shoulder seams sit against the shoulder point, the room in the body and sleeves, where the sleeves and hem end, how the cloth hangs. Use the listing to confirm what the photo shows: a fit word, or the size pictured against the model's height and chest (many shops shoot a size up on a slim model, and that is the look the editor will reproduce). Describe the cut as photographed, plainly and in positions, never in words that sell.`

export function buildCutRequest(listing: CutListing) {
  const words = {
    title: listing.title,
    garment: listing.garment_type,
    tags: listing.tags.slice(0, 24),
    description: plainText(listing.body_html).slice(0, 1500) || null,
  }
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: 'image', source: { type: 'url', url: productImageAt(listing.image, IMAGE_WIDTH) } },
    { type: 'text', text: `The shop's photo is above. The listing:\n\n${JSON.stringify(words, null, 2)}\n\nDescribe the cut.` },
  ]
  // Without `parse`, the SDK passes the schema through and leaves the text alone.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parse: _parse, ...format } = zodOutputFormat(CutSchema)
  return {
    model: MODELS.cut,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: CUT_SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content }],
    output_config: { effort: 'low' as const, format },
  }
}

/** One Sonnet call. Null, with the reason in the server log, when it gives no usable read. */
export const readCutWithClaude: CutReader = async (listing) => {
  const response = await claude().beta.messages.create(buildCutRequest(listing), { maxRetries: 2, timeout: CALL_TIMEOUT_MS })
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    console.error('garment-cut: no read', listing.product_id, response.stop_reason)
    return null
  }
  const parsed = CutSchema.safeParse(plainDashes(parseJson(finalText(response.content))))
  if (!parsed.success || parsed.data.silhouette.trim() === '') {
    console.error('garment-cut: unexpected shape', listing.product_id)
    return null
  }
  return {
    cut: { fit: parsed.data.fit, silhouette: parsed.data.silhouette.trim() },
    model: MODELS.cut,
    served_by: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    usd: callUsd(MODELS.cut, response.usage),
  }
}

/**
 * The cut of each of these finds, by product id: kept from an earlier read of
 * the same photo, else read now and kept. A find whose read fails is left
 * out, and its try-on keeps the prompt's general line; nothing here throws.
 */
export async function cutsFor(
  listings: CutListing[],
  options: { sql?: Sql; read?: CutReader } = {},
): Promise<Map<number, Cut>> {
  const sql = options.sql ?? db()
  const read = options.read ?? readCutWithClaude
  const wanted = listings.filter((listing) => readsCut(listing.garment_type, listing.image))
  const cuts = new Map<number, Cut>()
  if (wanted.length === 0) return cuts

  const kept = await sql<{ product_id: number; image_src: string; fit: Fit | null; silhouette: string }[]>`
    select product_id::int as product_id, image_src, fit, silhouette from product_cuts
    where product_id = any (${wanted.map((listing) => listing.product_id)}::bigint[])
  `
  const missing: CutListing[] = []
  for (const listing of wanted) {
    const row = kept.find((cut) => cut.product_id === listing.product_id && cut.image_src === listing.image)
    if (row) cuts.set(listing.product_id, { fit: row.fit, silhouette: row.silhouette })
    else missing.push(listing)
  }

  await Promise.all(
    missing.map(async (listing) => {
      try {
        const result = await read(listing)
        if (!result) return
        cuts.set(listing.product_id, result.cut)
        await sql`
          insert into product_cuts ${sql({
            product_id: listing.product_id,
            image_src: listing.image,
            fit: result.cut.fit,
            silhouette: result.cut.silhouette,
            model: result.model,
            served_by: result.served_by,
            input_tokens: result.input_tokens,
            output_tokens: result.output_tokens,
            usd: result.usd,
          })}
          on conflict (product_id, image_src) do nothing
        `
      } catch (error) {
        console.error('garment-cut: read failed', listing.product_id, error)
      }
    }),
  )
  return cuts
}

/** The listings of these finds, for a read, each with the photo its try-on sends. */
export async function cutListings(sql: Sql, finds: { product_id: number; image: string; garment_type?: string | null }[]): Promise<CutListing[]> {
  if (finds.length === 0) return []
  const rows = await sql<Omit<CutListing, 'image'>[]>`
    select id::int as product_id, title, garment_type, body_html, tags from products
    where id = any (${finds.map((find) => find.product_id)}::bigint[])
  `
  return finds.flatMap((find) => {
    const row = rows.find((product) => product.product_id === find.product_id)
    return row ? [{ ...row, image: find.image, garment_type: find.garment_type ?? row.garment_type }] : []
  })
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
