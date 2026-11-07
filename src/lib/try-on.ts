import { createHash } from 'node:crypto'
import path from 'node:path'

import sharp, { type OutputInfo } from 'sharp'
import { z } from 'zod'

import { db, type Sql } from './db.ts'
import { findPhotoFile, findPhotoId } from './find-photos.ts'
import { cutListings, cutsFor, type Cut, type CutReader } from './garment-cut.ts'
import { findKey, lookOutfitKey, outfitKey } from './outfit-key.ts'
import { productImageAt } from './product-image.ts'
import { files } from './storage.ts'

/*
 * Try-on: "See it on me" on a feed find, on a look, on pieces he chose
 * himself on the On me page (an outfit: any mix of his wardrobe pieces and the
 * finds he saved), or on a statement piece with the pieces of his Claude said
 * it wears with. One of Malin's full-length photos goes to OpenAI's image
 * editor with the product's own photo (a find), or with the photos of the
 * pieces (a look or an outfit), and it returns him wearing it. Agreed with Malin on 2026-11-04, with the photo rule
 * in docs/plan.md section 1.1: made on request only, one at a time (a unique
 * index holds that), kept in the file store, deleted with his photos.
 * OpenAI does not train on API data and keeps requests up to 30 days for
 * abuse monitoring.
 *
 * Making one takes up to two minutes, so the server action only records the
 * request; the image is made after the response (next/server `after`), and the
 * card asks for the status until it is ready. A request whose server died
 * mid-way is called failed after STALE_MINUTES.
 *
 * A picture is of an outfit, whatever asked for it (migration 0016): a find
 * alone, or a set of pieces and finds, keyed by outfitKey. Once there is a
 * picture of an outfit, ready or being made, every card and the chooser show
 * that one, and a tap that would make it again opens it instead. Only "Make
 * it again" makes a second.
 */

export const PROVIDER = 'openai'
/** OpenAI's model for "workflows where editing precision matters most". */
export const MODEL = 'gpt-image-2.5-sunburst'
export const QUALITY = 'high'
const ENDPOINT = 'https://api.openai.com/v1/images/edits'
const GENERATE_ENDPOINT = 'https://api.openai.com/v1/images/generations'

/** US dollars per million tokens, from developers.openai.com/api/docs/pricing (2026-11-04). */
export const RATES = { textInput: 5, imageInput: 8, output: 30 } as const

/** Longest edge asked of the model; his photos are 1568 on the long edge. */
export const OUTPUT_EDGE = 1536
const PRODUCT_EDGE = 1536
const CALL_TIMEOUT_MS = 4 * 60 * 1000
export const STALE_MINUTES = 6

export const TRY_ON_DIR = 'try-ons'

/** The editor takes at most 16 images: him, and up to 15 garments. */
export const MAX_GARMENT_IMAGES = 15

export class TryOnError extends Error {}

export type TryOnStatus = 'making' | 'ready' | 'failed'

/** What a card needs to know about the latest try-on of its find. */
export type OnMe = {
  id: number
  status: TryOnStatus
  error: string | null
  width: number | null
  height: number | null
  usd: number | null
  started_at: Date
  photo_taken: Date
}

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

/**
 * The output size: his photo's own aspect, long edge OUTPUT_EDGE, both edges a
 * multiple of 16 as the model requires. Keeping his aspect matters: a square
 * or a different crop would squash or stretch him, and his proportions are
 * half of what he is judging.
 */
export function outputSize(width: number, height: number): { width: number; height: number } {
  const ratio = Math.min(3, Math.max(1 / 3, width / height))
  const round16 = (value: number) => Math.max(16, Math.round(value / 16) * 16)
  return ratio <= 1
    ? { width: round16(OUTPUT_EDGE * ratio), height: OUTPUT_EDGE }
    : { width: OUTPUT_EDGE, height: round16(OUTPUT_EDGE / ratio) }
}

export const UsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    input_tokens_details: z
      .object({ text_tokens: z.number().int().nonnegative().optional(), image_tokens: z.number().int().nonnegative().optional() })
      .partial()
      .optional(),
  })
  .passthrough()

export type Usage = z.infer<typeof UsageSchema>

/**
 * What one image cost, from the usage OpenAI reports. Input text and input
 * images are priced apart; every output token is priced as an image token, the
 * higher rate, so an unexpected text token never makes it look cheaper.
 */
export function tryOnCost(usage: Usage): number {
  const input = usage.input_tokens ?? 0
  const imageIn = usage.input_tokens_details?.image_tokens ?? input
  const textIn = usage.input_tokens_details?.text_tokens ?? Math.max(0, input - imageIn)
  const usd = (textIn * RATES.textInput + imageIn * RATES.imageInput + (usage.output_tokens ?? 0) * RATES.output) / 1e6
  return Math.round(usd * 1e6) / 1e6
}

type Placement = { noun: string; how: string }

/** How a garment of each type is worn, so the model replaces the right thing. */
export function placement(garmentType: string | null): Placement {
  switch (garmentType) {
    case 'tee':
    case 'tank':
    case 'polo':
    case 'shirt':
    case 'knitwear':
    case 'sweatshirt':
      return { noun: 'top', how: 'in place of the top he is wearing' }
    case 'overshirt':
    case 'jacket':
    case 'coat':
    case 'tailoring':
      return { noun: 'outer layer', how: 'over the top he is wearing, open or closed as in image 2' }
    case 'trousers':
    case 'jeans':
    case 'shorts':
      return { noun: 'trousers', how: 'in place of the trousers he is wearing, with the same hem break as in image 2' }
    case 'shoes':
    case 'boots':
    case 'sneakers':
      return { noun: 'pair of shoes', how: 'in place of the shoes he is wearing' }
    case 'bag':
      return { noun: 'bag', how: 'carried the way it is meant to be carried' }
    case 'belt':
      return { noun: 'belt', how: 'through the belt loops of the trousers he is wearing' }
    case 'accessory':
      return { noun: 'accessory', how: 'worn the way it is meant to be worn' }
    default:
      return { noun: 'piece', how: 'in place of the matching piece he is wearing' }
  }
}

const KEEP_HIM =
  'Keep him exactly as he is: face, hair, skin tone, build, body shape, height and proportions, pose, expression, camera angle, lighting and background. Do not slim, lengthen, straighten or flatter him. That is his body, not the clothes: what he puts on keeps its own cut and volume, and may stand away from him.'

/** A sentence, ending in a full stop. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * The fit line when a find's cut was read (src/lib/garment-cut.ts): its
 * shape in positions, measured against his own frame, never taken in.
 */
function cutLine(cut: Cut): string {
  return [
    `Its cut, as the shop photographs it${cut.fit ? `: ${cut.fit}` : ''}.`,
    sentence(cut.silhouette),
    'Keep exactly that cut on him, measured against his own shoulders, arms and waist; never take it in to his shape. Let it drape with natural creases and no smoothing.',
  ].join(' ')
}

/**
 * The instruction. Image 1 is him, image 2 the product. What it asks for, in
 * order of what matters: him unchanged (proportions are what he is judging),
 * the garment exactly as sold (colour first, since colour is the point of the
 * app), then the fit it is cut for: in words when its cut was read, since the
 * editor left to the photo fits everything close to him. It asks for no
 * flattery.
 */
export function tryOnPrompt(
  product: { title: string; garment_type: string | null; colour: string | null },
  cut: Cut | null = null,
): string {
  const { noun, how } = placement(product.garment_type)
  const colour = product.colour ? `, in ${product.colour}` : ''
  return [
    `Image 1 is a photo of a man. Image 2 is a shop's product photo of "${product.title}"${colour}.`,
    `Make a photograph of the man in image 1 wearing that exact ${noun} ${how}, so he can judge honestly whether to buy it.`,
    KEEP_HIM,
    `Reproduce the ${noun} exactly as in image 2: the same colour and shade, shown under the light of image 1 without shifting its hue, brightness or saturation; the same fabric, texture, weight, pattern, cut, length, collar, buttons, pockets, stitching and hardware. Add nothing that is not in image 2: no logos, text or details.`,
    `Change nothing else he is wearing. If image 2 shows a model or other clothes, take only the ${noun}.`,
    cut
      ? cutLine(cut)
      : 'Let it keep the cut image 2 shows, on his frame: the same room, length and line, never taken in to his shape. Let it drape with natural creases and no smoothing.',
  ].join('\n')
}

/**
 * A piece of a look or an outfit as it was sent, kept on the row so a remake
 * can be compared: one of his wardrobe pieces (piece_id), or a find he saved
 * (product_id, on outfits only).
 */
export type PieceSent = {
  /** Null for a saved find. */
  piece_id: number | null
  /** A saved find; absent on a wardrobe piece, and on rows from before outfits. */
  product_id?: number | null
  name: string
  garment_type: string | null
  colour_name: string | null
  colour_hex: string | null
  fabric: string | null
  fit: string | null
  /** How it was shown: his own photo of it, the shop's photo, or only in words. */
  shown: { kind: 'photo'; photo_id: number } | { kind: 'product'; src: string } | { kind: 'words' }
}

/** "ink navy (#1f2942)", "#1f2942", "ink navy", or null. */
function colourWords(piece: Pick<PieceSent, 'colour_name' | 'colour_hex'>): string | null {
  if (piece.colour_name && piece.colour_hex) return `${piece.colour_name} (${piece.colour_hex})`
  return piece.colour_name ?? piece.colour_hex
}

/**
 * One line per piece, numbering the photos from image 2 in order and
 * describing a piece with no photo in words. A piece of his says the fit he
 * filed it as; a find whose cut was read says it in positions, by product id.
 */
function pieceLines(pieces: PieceSent[], cuts: Map<number, Cut> = new Map()): { lines: string[]; lastImage: number } {
  let image = 1
  const lines = pieces.map((piece) => {
    const { noun } = placement(piece.garment_type)
    const colour = colourWords(piece)
    if (piece.shown.kind === 'words') {
      const cloth = [piece.fit ? `${piece.fit} fit` : null, piece.fabric].filter(Boolean).join(', ')
      return `- No photo: "${piece.name}", the ${noun}${colour ? `, in ${colour}` : ''}${cloth ? `, ${cloth}` : ''}.`
    }
    image += 1
    const cut = piece.piece_id === null && piece.product_id ? cuts.get(piece.product_id) : undefined
    const fit = cut ? cut.fit : piece.fit
    const shape = cut ? ` Cut as photographed: ${sentence(cut.silhouette)}` : ''
    return `- Image ${image}: "${piece.name}", the ${noun}${colour ? `, ${colour}` : ''}${fit ? `, ${fit} fit` : ''}.${shape}`
  })
  return { lines, lastImage: image }
}

const EACH_AS_PHOTOGRAPHED =
  'Reproduce each piece exactly as in its photo: the same colour and shade, shown under the light of image 1 without shifting its hue, brightness or saturation; the same fabric, texture, weight, pattern, cut, length, collar, buttons, pockets, stitching and hardware. Take only the garment from each photo, nothing of the bed, floor, hanger, model or other clothes around it. Make a piece given only in words plainly, in exactly that colour, with no pattern, logos or details that are not described. Add no logos, text or details anywhere.'

const NATURAL_FIT =
  'Let each piece keep its own cut, as its photo and its line show it, on his frame: the same room, length and line, never taken in to his shape. Let each drape with natural creases and no smoothing.'

/**
 * The instruction for a whole look. Image 1 is him; the pieces with a photo
 * follow in the look's order, outermost first, and a piece with no photo is
 * described in words. The same priorities as a find: him unchanged, every
 * piece exactly as it is (colour first), a believable fit, no flattery.
 */
export function lookTryOnPrompt(look: { title: string; styling: string | null; pieces: PieceSent[] }): string {
  const { lines, lastImage } = pieceLines(look.pieces)
  const photos = lastImage > 1 ? `Images 2 to ${lastImage} are photos of clothes he owns, some laid flat or on a hanger, some a shop's photo.` : null
  return [
    ['Image 1 is a photo of a man.', photos].filter(Boolean).join(' '),
    `Make a photograph of the man in image 1 dressed in this whole outfit, "${look.title}", so he can judge honestly how it looks on him. The pieces, from the outermost layer in:`,
    ...lines,
    look.styling ? `Wear it this way: ${look.styling}` : null,
    KEEP_HIM,
    EACH_AS_PHOTOGRAPHED,
    'Replace everything he is wearing with this outfit, layered in the order listed, the outer layer over the rest.',
    NATURAL_FIT,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/**
 * The instruction for pieces he chose himself, in layer order. They need not
 * make a whole outfit (a saved jacket over the tee he has on is a fair
 * question), so each goes in place of the matching thing he is wearing and
 * the rest of what he has on stays.
 */
export function outfitTryOnPrompt(pieces: PieceSent[], cuts: Map<number, Cut> = new Map()): string {
  const { lines, lastImage } = pieceLines(pieces, cuts)
  const owned = pieces.some((piece) => piece.piece_id !== null && piece.shown.kind !== 'words')
  const saved = pieces.some((piece) => piece.piece_id === null && piece.shown.kind !== 'words')
  const one = lastImage === 2
  const photos =
    lastImage < 2
      ? null
      : owned && saved
        ? `Images 2 to ${lastImage} are photos of clothes: some he owns, laid flat, on a hanger or in a shop's photo, and some a shop's photo of a piece he is thinking of buying.`
        : saved
          ? one
            ? "Image 2 is a shop's photo of a piece he is thinking of buying."
            : `Images 2 to ${lastImage} are shops' photos of pieces he is thinking of buying.`
          : one
            ? "Image 2 is a photo of a piece he owns, laid flat, on a hanger or in a shop's photo."
            : `Images 2 to ${lastImage} are photos of clothes he owns, some laid flat or on a hanger, some a shop's photo.`
  return [
    ['Image 1 is a photo of a man.', photos].filter(Boolean).join(' '),
    `Make a photograph of the man in image 1 wearing ${pieces.length === 1 ? 'this piece' : 'these pieces together'}, so he can judge honestly how ${pieces.length === 1 ? 'it looks' : 'they look'} on him. ${pieces.length === 1 ? 'The piece:' : 'The pieces, from the outermost layer in:'}`,
    ...lines,
    KEEP_HIM,
    EACH_AS_PHOTOGRAPHED,
    `Put each piece on in place of the matching thing he is wearing${pieces.length === 1 ? '' : ', layered in the order listed, the outer layer over the rest'}. Change nothing else he is wearing.`,
    NATURAL_FIT,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** How far out a garment is worn: outer layers first, then down to the shoes and what is carried. */
export function layer(garmentType: string | null): number {
  switch (garmentType) {
    case 'coat':
      return 0
    case 'jacket':
    case 'tailoring':
      return 1
    case 'overshirt':
      return 2
    case 'knitwear':
    case 'sweatshirt':
      return 3
    case 'shirt':
    case 'polo':
      return 4
    case 'tee':
    case 'tank':
    case 'activewear':
      return 5
    case 'trousers':
    case 'jeans':
    case 'shorts':
      return 6
    case 'shoes':
    case 'boots':
    case 'sneakers':
      return 7
    case 'belt':
    case 'bag':
    case 'accessory':
      return 8
    default:
      return 9
  }
}

// ---------------------------------------------------------------------------
// The provider call
// ---------------------------------------------------------------------------

const ResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
  usage: UsageSchema.optional(),
})

const ErrorSchema = z.object({
  error: z.object({ message: z.string().optional(), code: z.string().nullable().optional(), type: z.string().nullable().optional() }),
})

export type EditRequest = {
  /**
   * In the order the prompt names them: for a try-on him first, then the
   * product photo or the photos of the pieces; for a look's flat lay the
   * pieces' photos alone. With none, the picture is drawn from the prompt.
   */
  images: Buffer[]
  prompt: string
  size: { width: number; height: number }
}

export type EditResult = { image: Buffer; usage: Usage | null; requestId: string | null }

/** Words for the card when OpenAI says no; the raw message goes to the server log. */
function refusal(status: number, body: unknown): string {
  const parsed = ErrorSchema.safeParse(body)
  const code = parsed.success ? `${parsed.data.error.code ?? ''} ${parsed.data.error.type ?? ''}` : ''
  if (/moderation|safety|content_policy/.test(code)) return 'OpenAI declined to make this one.'
  if (status === 401) return 'The OpenAI key was not accepted. Check OPENAI_API_KEY.'
  if (/insufficient_quota|billing/.test(code)) return 'The OpenAI account is out of credit.'
  if (status === 429) return 'OpenAI is busy. Try again in a minute.'
  return 'OpenAI could not make it this time. Try again.'
}

/**
 * One call to the image editor, or to the generator when there is no image to
 * edit from (a look whose pieces are all described in words). `fetchImpl` is
 * the seam the tests use.
 */
export async function editImage(request: EditRequest, fetchImpl: typeof fetch = fetch): Promise<EditResult> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new TryOnError('Try-on needs an OpenAI key: add OPENAI_API_KEY to the server’s environment.')
  const dataUrl = (bytes: Buffer) => `data:image/jpeg;base64,${bytes.toString('base64')}`

  let response: Response
  try {
    const edit = request.images.length > 0
    response = await fetchImpl(edit ? ENDPOINT : GENERATE_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        ...(edit ? { images: request.images.map((bytes) => ({ image_url: dataUrl(bytes) })) } : {}),
        prompt: request.prompt,
        size: `${request.size.width}x${request.size.height}`,
        quality: QUALITY,
        output_format: 'jpeg',
        output_compression: 95,
        background: 'opaque',
        n: 1,
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
  } catch (error) {
    console.error('try-on: request failed', error)
    throw new TryOnError('Could not reach OpenAI. Try again.')
  }

  const requestId = response.headers.get('x-request-id')
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    console.error('try-on: OpenAI refused', response.status, requestId, JSON.stringify(body))
    throw new TryOnError(refusal(response.status, body))
  }
  const parsed = ResponseSchema.safeParse(body)
  if (!parsed.success) {
    console.error('try-on: unexpected response', requestId, parsed.error.message)
    throw new TryOnError('OpenAI sent back no image. Try again.')
  }
  return { image: Buffer.from(parsed.data.data[0]!.b64_json, 'base64'), usage: parsed.data.usage ?? null, requestId }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The shop's photo at the edge OpenAI is sent. */
export function productImageUrl(src: string, width = PRODUCT_EDGE): string {
  return productImageAt(src, width)
}

/**
 * The product photo as a plain JPEG: the shop may serve WebP, PNG with
 * transparency or a 4000px original. Transparency goes onto white, as a shop
 * photo would sit.
 */
export async function fetchProductImage(src: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  // A find he added by hand shows the photo he chose, which is on our own volume.
  const own = findPhotoId(src)
  if (own !== null) {
    const bytes = await findPhotoFile(own, 'master')
    if (!bytes) throw new TryOnError('The find’s photo has gone. Add the find again with its photo.')
    return asJpeg(bytes, 'The find’s photo could not be read.')
  }
  let response: Response
  try {
    response = await fetchImpl(productImageUrl(src), {
      headers: { 'user-agent': 'wardrobe/0.1 (personal menswear stylist)' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new TryOnError('The shop’s photo could not be fetched. Try again.')
  }
  if (!response.ok) throw new TryOnError('The shop’s photo could not be fetched. Try again.')
  return asJpeg(Buffer.from(await response.arrayBuffer()), 'The shop’s photo could not be read.')
}

/** Any garment photo as a plain JPEG held to the edge sent, transparency on white. */
async function asJpeg(bytes: Buffer, unreadable: string): Promise<Buffer> {
  try {
    return await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({ width: PRODUCT_EDGE, height: PRODUCT_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer()
  } catch {
    throw new TryOnError(unreadable)
  }
}

/** His own photo of a piece, the stored master. Never fetched from a shop. */
export async function piecePhoto(sql: Sql, photoId: number): Promise<Buffer> {
  const [row] = await sql<{ path: string }[]>`select path from wardrobe_photos where id = ${photoId}`
  if (!row) throw new TryOnError('A piece’s photo has changed since you asked. Try again.')
  try {
    const bytes = await files().get(row.path)
    if (!bytes) throw new TryOnError('A piece’s photo could not be read.')
    return await asJpeg(bytes, 'A piece’s photo could not be read.')
  } catch (error) {
    if (error instanceof TryOnError) throw error
    throw new TryOnError('A piece’s photo could not be read.')
  }
}

type FullLength = { id: number; path: string; width: number; height: number; created_at: Date }

/** The newest full-length photo still kept. */
export async function fullLengthPhoto(sql: Sql = db()): Promise<FullLength | null> {
  const [row] = await sql<FullLength[]>`
    select id::int as id, path, coalesce(width, 1176) as width, coalesce(height, 1568) as height, created_at
    from profile_photos where kind = 'full_body' and deleted_at is null
    order by created_at desc, id desc limit 1
  `
  return row ?? null
}

type ProductForTryOn = { id: number; title: string; garment_type: string | null; image: string | null; colour: string | null }

async function productForTryOn(sql: Sql, productId: number): Promise<ProductForTryOn | null> {
  const [row] = await sql<ProductForTryOn[]>`
    select p.id::int as id, p.title, p.garment_type, p.main_image ->> 'src' as image,
           ${judgedColour(sql)} as colour
    from products p where p.id = ${productId}
  `
  return row ?? null
}

// ---------------------------------------------------------------------------
// The lifecycle: start, make, read
// ---------------------------------------------------------------------------

/** A request left in the making by a server that died is called failed. */
async function sweepStale(sql: Sql): Promise<void> {
  await sql`
    update try_ons set status = 'failed', finished_at = now(), error = 'It took too long. Try again.'
    where status = 'making' and started_at < now() - make_interval(mins => ${STALE_MINUTES})
  `
}

/** `reused` when the picture was already there, so nothing new was made. */
export type Started = { ok: true; id: number; reused?: boolean } | { ok: false; message: string }

/** Ask for a new picture even when one of the same outfit is kept: "Make it again". */
export type StartOptions = { again?: boolean }

/** A try-on aliased `t` that is kept and worth showing: ready, or still being made. */
export const showableTryOn = (sql: Sql) => sql`
  (t.status = 'ready' or (t.status = 'making' and t.started_at >= now() - make_interval(mins => ${STALE_MINUTES})))
`

/** The newest kept picture of this outfit, ready before one in the making, from a photo he still has. */
export async function keptTryOn(key: string, sql: Sql = db()): Promise<number | null> {
  const [row] = await sql<{ id: number }[]>`
    select t.id::int as id
    from try_ons t join profile_photos ph on ph.id = t.photo_id and ph.deleted_at is null
    where t.outfit_key = ${key} and t.deleted_at is null and ${showableTryOn(sql)}
    order by t.status = 'ready' desc, t.started_at desc, t.id desc
    limit 1
  `
  return row?.id ?? null
}

/**
 * Record a request for one try-on, or answer with the picture of it already
 * kept. Refuses when there is no key, no full-length photo, no product photo,
 * or another try-on is still being made.
 */
export async function startTryOn(productId: number, sql: Sql = db(), options: StartOptions = {}): Promise<Started> {
  if (!options.again) {
    const kept = await keptTryOn(findKey(productId), sql)
    if (kept !== null) return { ok: true, id: kept, reused: true }
  }
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, message: 'Try-on needs an OpenAI key: add OPENAI_API_KEY to the server’s environment.' }
  }
  const [photo, product] = await Promise.all([fullLengthPhoto(sql), productForTryOn(sql, productId)])
  if (!photo) return { ok: false, message: 'Add a full-length photo under You, Photos first.' }
  if (!product?.image) return { ok: false, message: 'This find has no photo to try on.' }

  await sweepStale(sql)
  const size = outputSize(photo.width, photo.height)
  try {
    const [row] = await sql<{ id: number }[]>`
      insert into try_ons ${sql({
        product_id: productId,
        outfit_key: findKey(productId),
        photo_id: photo.id,
        product_image: product.image,
        provider: PROVIDER,
        model: MODEL,
        prompt: tryOnPrompt(product),
        settings: sql.json({ size: `${size.width}x${size.height}`, quality: QUALITY }),
      })}
      returning id::int as id
    `
    return { ok: true, id: row!.id }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, message: 'Another try-on is still being made. One at a time.' }
    }
    throw error
  }
}

export type LookForTryOn = {
  title: string
  styling: string | null
  piece_count: number
  pieces: (Omit<PieceSent, 'shown'> & { photo_id: number | null; image: string | null })[]
}

export async function lookForTryOn(sql: Sql, lookId: number): Promise<LookForTryOn | null> {
  const [row] = await sql<LookForTryOn[]>`
    select l.title, l.styling, l.piece_count,
           coalesce(json_agg(json_build_object(
             'piece_id', p.id, 'name', p.name, 'garment_type', p.garment_type,
             'colour_name', p.colour_name, 'colour_hex', p.colour_hex, 'fabric', p.fabric, 'fit', p.fit,
             'photo_id', p.photo_id, 'image', pr.main_image ->> 'src'
           ) order by lp.position) filter (where p.id is not null), '[]'::json) as pieces
    from looks l
    left join look_pieces lp on lp.look_id = l.id
    left join wardrobe_pieces p on p.id = lp.piece_id
    left join products pr on pr.id = p.product_id
    where l.id = ${lookId}
    group by l.id
  `
  return row ?? null
}

/**
 * How each piece is shown to the editor: his own photo first (it is the piece
 * he owns, as it is now), else the shop's photo, else in words. Past the
 * editor's image limit, the rest go in words.
 */
export function showPieces(pieces: (Omit<PieceSent, 'shown'> & { photo_id: number | null; image: string | null })[]): PieceSent[] {
  let images = 0
  return pieces.map(({ photo_id, image, ...piece }) => {
    const room = images < MAX_GARMENT_IMAGES
    if (room && photo_id !== null) {
      images += 1
      return { ...piece, shown: { kind: 'photo', photo_id } }
    }
    if (room && image) {
      images += 1
      return { ...piece, shown: { kind: 'product', src: image } }
    }
    return { ...piece, shown: { kind: 'words' } }
  })
}

/**
 * Record a request for a try-on of a whole look, or answer with the picture
 * of the same pieces already kept, whichever look or choice it was made for.
 * Refuses when there is no key, no full-length photo, a piece of the look has
 * gone from the wardrobe, or another try-on is still being made.
 */
export async function startLookTryOn(lookId: number, sql: Sql = db(), options: StartOptions = {}): Promise<Started> {
  const look = await lookForTryOn(sql, lookId)
  if (!look) return { ok: false, message: 'That look could not be found.' }
  if (look.pieces.length === 0 || look.pieces.length < look.piece_count) {
    return { ok: false, message: 'A piece of this look is no longer in your wardrobe.' }
  }
  const key = outfitKey(look.pieces)
  if (!options.again) {
    const kept = await keptTryOn(key, sql)
    if (kept !== null) return { ok: true, id: kept, reused: true }
  }
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, message: 'Try-on needs an OpenAI key: add OPENAI_API_KEY to the server’s environment.' }
  }
  const photo = await fullLengthPhoto(sql)
  if (!photo) return { ok: false, message: 'Add a full-length photo under You, Photos first.' }

  await sweepStale(sql)
  const size = outputSize(photo.width, photo.height)
  const pieces = showPieces(look.pieces)
  try {
    const [row] = await sql<{ id: number }[]>`
      insert into try_ons ${sql({
        look_id: lookId,
        outfit_key: key,
        photo_id: photo.id,
        pieces: sql.json(pieces),
        provider: PROVIDER,
        model: MODEL,
        prompt: lookTryOnPrompt({ title: look.title, styling: look.styling, pieces }),
        settings: sql.json({ size: `${size.width}x${size.height}`, quality: QUALITY }),
      })}
      returning id::int as id
    `
    return { ok: true, id: row!.id }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, message: 'Another try-on is still being made. One at a time.' }
    }
    throw error
  }
}

/** The most pieces one outfit try-on takes: a full outfit with a layer and a bag is seven. */
export const MAX_OUTFIT_PIECES = 8

export type OutfitChoice = { piece_ids: number[]; product_ids: number[] }

/**
 * The colour option a find's latest verdict judged, for a product aliased
 * `p`: the feed's score, else its score as a statement piece.
 */
const judgedColour = (sql: Sql) => sql`
  coalesce(
    (select s.colour_option from product_scores s where s.product_id = p.id order by s.scored_at desc limit 1),
    (select s.colour_option from statement_scores s where s.product_id = p.id order by s.scored_at desc limit 1)
  )
`

/**
 * A find's colour, for a product aliased `p`: as its latest verdict judged
 * it, else the colours its listing names (a pasted link is never scored), as
 * the Saved list on Today shows it.
 */
export const findColour = (sql: Sql) => sql`
  coalesce(
    ${judgedColour(sql)},
    (select string_agg(colour, ', ' order by first_id) from (
       select option_colour as colour, min(id) as first_id from product_variants
       where product_id = p.id and option_colour is not null group by option_colour
     ) listed)
  )
`

type Choosable = Omit<PieceSent, 'shown'> & { photo_id: number | null; image: string | null }

/**
 * Which finds an outfit may hold: those he saved, as the On me chooser offers
 * them, or any the shops listed (a statement piece, or a picture made again
 * after he cleared the find).
 */
type FindsTaken = 'saved' | 'any'

/** The chosen wardrobe pieces still in the wardrobe, and the chosen finds still taken. */
async function chosenPieces(sql: Sql, choice: OutfitChoice, finds: FindsTaken): Promise<Choosable[]> {
  const [pieces, products] = await Promise.all([
    choice.piece_ids.length === 0
      ? []
      : sql<Choosable[]>`
          select p.id::int as piece_id, p.name, p.garment_type, p.colour_name, p.colour_hex, p.fabric, p.fit,
                 p.photo_id::int as photo_id, pr.main_image ->> 'src' as image
          from wardrobe_pieces p left join products pr on pr.id = p.product_id
          where p.id = any (${choice.piece_ids}::bigint[]) and p.set_aside_at is null
        `,
    choice.product_ids.length === 0
      ? []
      : sql<Choosable[]>`
          with latest_action as (
            select distinct on (product_id) product_id, slot_id, action
            from feed_actions where product_id = any (${choice.product_ids}::bigint[])
            order by product_id, created_at desc, id desc
          )
          select null::int as piece_id, p.id::int as product_id, p.title as name,
                 coalesce(p.garment_type, bs.garment_type) as garment_type,
                 ${findColour(sql)} as colour_name,
                 null::text as colour_hex, null::text as fabric, null::text as fit,
                 null::int as photo_id, p.main_image ->> 'src' as image
          from products p
          left join latest_action a on a.product_id = p.id
          left join blueprint_slots bs on bs.id = a.slot_id
          where p.id = any (${choice.product_ids}::bigint[])
            and ${finds === 'saved' ? sql`a.action = 'saved'` : sql`true`}
        `,
  ])
  return [...pieces, ...products]
}

/**
 * Record a request for a try-on of pieces he chose: wardrobe pieces and saved
 * finds, put on in layer order; or answer with the picture of exactly those
 * already kept (of a look, a find, or an earlier choice). Refuses when there
 * is no key, no full-length photo, nothing or too much chosen, something
 * chosen has since left the wardrobe or his saved finds, or another try-on is
 * still being made.
 */
export async function startOutfitTryOn(choice: OutfitChoice, sql: Sql = db(), options: StartOptions = {}): Promise<Started> {
  return startChosen(choice, sql, {
    ...options,
    finds: 'saved',
    gone: 'Something you chose is no longer in your wardrobe or saved. Choose again.',
  })
}

/**
 * Record a request for a statement piece worn with the pieces of his Claude
 * said it wears with, as its card shows them; or answer with the picture of
 * that outfit already kept. The find need not be saved. Refuses, besides as
 * startOutfitTryOn does, when those pieces are not ones a verdict on the find
 * named.
 */
export async function startStatementTryOn(
  productId: number,
  pieceIds: number[],
  sql: Sql = db(),
  options: StartOptions = {},
): Promise<Started> {
  const wanted = [...new Set(pieceIds)]
  if (wanted.length === 0) return { ok: false, message: 'None of your pieces were named to wear it with.' }
  const [named] = await sql<{ id: number }[]>`
    select id::int as id from statement_scores
    where product_id = ${productId} and wears_with @> ${wanted}::bigint[]
    limit 1
  `
  if (!named) return { ok: false, message: 'That outfit could not be found. Reload the page.' }
  return startChosen({ piece_ids: wanted, product_ids: [productId] }, sql, {
    ...options,
    finds: 'any',
    gone: 'A piece of this outfit is no longer in your wardrobe. Reload the page.',
  })
}

/** The outfit try-ons' shared part: check the choice, find it kept, else record it. */
async function startChosen(
  choice: OutfitChoice,
  sql: Sql,
  options: StartOptions & { finds: FindsTaken; gone: string },
): Promise<Started> {
  const wanted = { piece_ids: [...new Set(choice.piece_ids)], product_ids: [...new Set(choice.product_ids)] }
  const count = wanted.piece_ids.length + wanted.product_ids.length
  if (count === 0) return { ok: false, message: 'Choose at least one piece.' }
  if (count > MAX_OUTFIT_PIECES) return { ok: false, message: `Choose up to ${MAX_OUTFIT_PIECES} pieces.` }

  const found = await chosenPieces(sql, wanted, options.finds)
  if (found.length < count) return { ok: false, message: options.gone }
  const outfit = outfitKey(found)
  if (!options.again) {
    const kept = await keptTryOn(outfit, sql)
    if (kept !== null) return { ok: true, id: kept, reused: true }
  }
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, message: 'Try-on needs an OpenAI key: add OPENAI_API_KEY to the server’s environment.' }
  }
  const photo = await fullLengthPhoto(sql)
  if (!photo) return { ok: false, message: 'Add a full-length photo under You, Photos first.' }

  // Outermost first, as a look is; the order chosen breaks a tie.
  const order = [...wanted.piece_ids.map((id) => `p${id}`), ...wanted.product_ids.map((id) => `f${id}`)]
  const key = (piece: Choosable) => (piece.piece_id !== null ? `p${piece.piece_id}` : `f${piece.product_id}`)
  const sorted = [...found].sort(
    (a, b) => layer(a.garment_type) - layer(b.garment_type) || order.indexOf(key(a)) - order.indexOf(key(b)),
  )

  await sweepStale(sql)
  const size = outputSize(photo.width, photo.height)
  const pieces = showPieces(sorted)
  try {
    const [row] = await sql<{ id: number }[]>`
      insert into try_ons ${sql({
        outfit_key: outfit,
        photo_id: photo.id,
        pieces: sql.json(pieces),
        provider: PROVIDER,
        model: MODEL,
        prompt: outfitTryOnPrompt(pieces),
        settings: sql.json({ size: `${size.width}x${size.height}`, quality: QUALITY }),
      })}
      returning id::int as id
    `
    return { ok: true, id: row!.id }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, message: 'Another try-on is still being made. One at a time.' }
    }
    throw error
  }
}

/**
 * "Make it again" from the On me page: the same find, the same look, or the
 * same chosen pieces, as they are now, on his newest full-length photo.
 */
export async function startAgain(tryOnId: number, sql: Sql = db()): Promise<Started> {
  const [row] = await sql<{ product_id: number | null; look_id: number | null; pieces: PieceSent[] | null }[]>`
    select product_id::int as product_id, look_id::int as look_id, pieces from try_ons where id = ${tryOnId}
  `
  if (!row) return { ok: false, message: 'That picture could not be found.' }
  const again = { again: true }
  if (row.product_id !== null) return startTryOn(row.product_id, sql, again)
  if (row.look_id !== null) return startLookTryOn(row.look_id, sql, again)
  // The same pieces and finds, whether or not he still has the finds saved: he is asking for this picture again.
  const pieces = row.pieces ?? []
  return startChosen(
    {
      piece_ids: pieces.flatMap((piece) => (piece.piece_id !== null ? [piece.piece_id] : [])),
      product_ids: pieces.flatMap((piece) => (piece.piece_id === null && piece.product_id ? [piece.product_id] : [])),
    },
    sql,
    { ...again, finds: 'any', gone: 'A piece of it is no longer in your wardrobe, so it cannot be made again.' },
  )
}

type Making = {
  id: number
  product_id: number | null
  look_id: number | null
  product_image: string | null
  pieces: PieceSent[] | null
  prompt: string
  settings: { size?: string }
  photo_path: string
  photo_deleted: boolean
}

/** The garment images for a request, in the order its prompt names them. */
async function garmentImages(sql: Sql, row: Making, fetchImpl: typeof fetch): Promise<Buffer[]> {
  if (row.product_image) return [await fetchProductImage(row.product_image, fetchImpl)]
  return Promise.all(
    (row.pieces ?? []).flatMap((piece) => {
      if (piece.shown.kind === 'photo') return [piecePhoto(sql, piece.shown.photo_id)]
      if (piece.shown.kind === 'product') return [fetchProductImage(piece.shown.src, fetchImpl)]
      return []
    }),
  )
}

/**
 * The prompt as sent: the one recorded, made again with the cut in words when
 * a find in it has had its cut read (src/lib/garment-cut.ts). The read is
 * made here rather than on the tap, so the card shows the picture in the
 * making at once; a find read before is not read again. A look holds only
 * his own pieces, whose fit is on the piece, so its prompt stands.
 */
async function promptWithCuts(sql: Sql, row: Making, read: CutReader | undefined): Promise<string> {
  if (row.look_id !== null) return row.prompt
  if (row.product_id !== null && row.product_image) {
    const [product, listings] = await Promise.all([
      productForTryOn(sql, row.product_id),
      cutListings(sql, [{ product_id: row.product_id, image: row.product_image }]),
    ])
    const cut = (await cutsFor(listings, { sql, read })).get(row.product_id)
    return product && cut ? tryOnPrompt(product, cut) : row.prompt
  }
  const pieces = row.pieces ?? []
  const finds = pieces.flatMap((piece) =>
    piece.piece_id === null && piece.product_id && piece.shown.kind === 'product'
      ? [{ product_id: piece.product_id, image: piece.shown.src, garment_type: piece.garment_type }]
      : [],
  )
  if (finds.length === 0) return row.prompt
  const cuts = await cutsFor(await cutListings(sql, finds), { sql, read })
  return cuts.size > 0 ? outfitTryOnPrompt(pieces, cuts) : row.prompt
}

/**
 * Make the image for a recorded request and file it. Never throws: whatever
 * goes wrong ends as a failed row with words for the card.
 */
export async function makeTryOn(
  id: number,
  options: { sql?: Sql; fetch?: typeof fetch; readCut?: CutReader } = {},
): Promise<TryOnStatus> {
  const sql = options.sql ?? db()
  const fetchImpl = options.fetch ?? fetch
  const [row] = await sql<Making[]>`
    select t.id::int as id, t.product_id::int as product_id, t.look_id::int as look_id,
           t.product_image, t.pieces, t.prompt, t.settings,
           ph.path as photo_path, ph.deleted_at is not null as photo_deleted
    from try_ons t join profile_photos ph on ph.id = t.photo_id
    where t.id = ${id} and t.status = 'making'
  `
  if (!row) return 'failed'

  try {
    if (row.photo_deleted) throw new TryOnError('The photo was deleted before it was made.')
    const [person, garments, prompt] = await Promise.all([
      files().get(row.photo_path),
      garmentImages(sql, row, fetchImpl),
      promptWithCuts(sql, row, options.readCut),
    ])
    if (!person) throw new TryOnError('Your photo is missing its file. Add it again on the Photos page.')
    // The row keeps the prompt as sent, which the picture's page shows.
    if (prompt !== row.prompt) await sql`update try_ons set prompt = ${prompt} where id = ${id} and status = 'making'`
    const [width, height] = (row.settings.size ?? `${OUTPUT_EDGE}x${OUTPUT_EDGE}`).split('x').map(Number)
    const result = await editImage(
      { images: [person, ...garments], prompt, size: { width: width!, height: height! } },
      fetchImpl,
    )

    // Re-encoded through sharp like his photos, which also drops any metadata.
    let file: { data: Buffer; info: OutputInfo }
    try {
      file = await sharp(result.image, { failOn: 'none' })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
    } catch {
      throw new TryOnError('OpenAI sent back an image that could not be read. Try again.')
    }
    const name = `${id}-${createHash('sha256').update(file.data).digest('hex').slice(0, 16)}.jpg`
    const relative = path.posix.join(TRY_ON_DIR, name)
    await files().put(relative, file.data, 'image/jpeg')

    const usage = result.usage
    // The photo may have been deleted while OpenAI was working; then the file goes too.
    const [saved] = await sql<{ id: number }[]>`
      update try_ons set
        status = 'ready', path = ${relative}, width = ${file.info.width}, height = ${file.info.height},
        request_id = ${result.requestId}, usage = ${usage ? sql.json(usage) : null},
        input_tokens = ${usage?.input_tokens ?? null}, output_tokens = ${usage?.output_tokens ?? null},
        usd = ${usage ? tryOnCost(usage) : null}, finished_at = now()
      where id = ${id} and status = 'making'
        and exists (select 1 from profile_photos ph where ph.id = try_ons.photo_id and ph.deleted_at is null)
      returning id
    `
    if (!saved) {
      await files().remove(relative).catch(() => {})
      throw new TryOnError('The photo was deleted before it was made.')
    }
    return 'ready'
  } catch (error) {
    if (!(error instanceof TryOnError)) console.error('try-on: failed', error)
    const message = error instanceof TryOnError ? error.message : 'Something went wrong making it. Try again.'
    await sql`
      update try_ons set status = 'failed', error = ${message}, finished_at = now()
      where id = ${id} and status = 'making'
    `
    return 'failed'
  }
}

const ON_ME_COLUMNS = (sql: Sql) => sql`
  t.id::int as id,
  case when t.status = 'making' and t.started_at < now() - make_interval(mins => ${STALE_MINUTES})
       then 'failed' else t.status end as status,
  case when t.status = 'making' and t.started_at < now() - make_interval(mins => ${STALE_MINUTES})
       then 'It took too long. Try again.' else t.error end as error,
  t.width, t.height, t.usd::float as usd, t.started_at, ph.created_at as photo_taken
`

/** One try-on's state, for the card asking whether it is ready. */
export async function getTryOn(id: number, sql: Sql = db()): Promise<OnMe | null> {
  const [row] = await sql<OnMe[]>`
    select ${ON_ME_COLUMNS(sql)}
    from try_ons t join profile_photos ph on ph.id = t.photo_id
    where t.id = ${id} and t.deleted_at is null
  `
  return row ?? null
}

/**
 * The picture of each of these outfits, by outfitKey, still kept. A ready or
 * in-the-making picture before a failed one, then the newest.
 */
export async function tryOnsByKey(keys: string[], sql: Sql = db()): Promise<Map<string, OnMe>> {
  if (keys.length === 0) return new Map()
  const rows = await sql<(OnMe & { outfit_key: string })[]>`
    select distinct on (t.outfit_key) t.outfit_key, ${ON_ME_COLUMNS(sql)}
    from try_ons t join profile_photos ph on ph.id = t.photo_id
    where t.outfit_key in ${sql([...new Set(keys)])} and t.deleted_at is null and ph.deleted_at is null
    order by t.outfit_key, ${showableTryOn(sql)} desc, t.started_at desc, t.id desc
  `
  return new Map(rows.map(({ outfit_key, ...onMe }) => [outfit_key, onMe]))
}

/**
 * The picture of each of these finds on its own, still kept: one asked for on
 * the find, or one of only that find chosen on the On me page.
 */
export async function latestTryOns(productIds: number[], sql: Sql = db()): Promise<Map<number, OnMe>> {
  const byKey = await tryOnsByKey(productIds.map(findKey), sql)
  return new Map(productIds.flatMap((id) => {
    const onMe = byKey.get(findKey(id))
    return onMe ? [[id, onMe] as const] : []
  }))
}

/**
 * The picture of each of these looks, still kept: one asked for on the look,
 * or of the same pieces asked for on another look or chosen on the On me
 * page. A ready or in-the-making picture before a failed one, then the newest.
 */
export async function latestLookTryOns(lookIds: number[], sql: Sql = db()): Promise<Map<number, OnMe>> {
  if (lookIds.length === 0) return new Map()
  const rows = await sql<(OnMe & { look_id: number })[]>`
    select distinct on (l.id) l.id::int as look_id, ${ON_ME_COLUMNS(sql)}
    from looks l
    join try_ons t on t.look_id = l.id or t.outfit_key = ${lookOutfitKey(sql)}
    join profile_photos ph on ph.id = t.photo_id
    where l.id in ${sql(lookIds)} and t.deleted_at is null and ph.deleted_at is null
    order by l.id, ${showableTryOn(sql)} desc, t.started_at desc, t.id desc
  `
  return new Map(rows.map(({ look_id, ...onMe }) => [look_id, onMe]))
}

/** The image file of a ready try-on, or null. */
export async function tryOnFile(id: number, sql: Sql = db()): Promise<Buffer | null> {
  const [row] = await sql<{ path: string }[]>`
    select path from try_ons where id = ${id} and status = 'ready' and deleted_at is null and path is not null
  `
  if (!row) return null
  return files().get(row.path)
}

export type TryOnSpend = { count: number; usd: number; thisMonthCount: number; thisMonthUsd: number }

/** What try-ons have cost, all time and this month in New Zealand time. Deleted images still count. */
export async function tryOnSpend(sql: Sql = db()): Promise<TryOnSpend> {
  const [row] = await sql<TryOnSpend[]>`
    select count(*)::int as count, coalesce(sum(usd), 0)::float as usd,
           (count(*) filter (where started_at >= (date_trunc('month', now() at time zone 'Pacific/Auckland')
                                                  at time zone 'Pacific/Auckland')))::int as "thisMonthCount",
           coalesce(sum(usd) filter (where started_at >= (date_trunc('month', now() at time zone 'Pacific/Auckland')
                                                         at time zone 'Pacific/Auckland')), 0)::float as "thisMonthUsd"
    from try_ons where status = 'ready'
  `
  return row ?? { count: 0, usd: 0, thisMonthCount: 0, thisMonthUsd: 0 }
}
