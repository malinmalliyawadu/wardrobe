import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp, { type OutputInfo } from 'sharp'
import { z } from 'zod'

import { db, type Sql } from './db.ts'
import { photosDir } from './photos.ts'

/*
 * Try-on: "See it on me" on a feed find. One of Malin's full-length photos and
 * the product's own photo go to OpenAI's image editor, which returns him
 * wearing it. Agreed with Malin on 2026-11-04, with the photo rule in
 * docs/plan.md section 1.1: made on request only, one at a time (a unique
 * index holds that), kept on the photos volume, deleted with his photos.
 * OpenAI does not train on API data and keeps requests up to 30 days for
 * abuse monitoring.
 *
 * Making one takes up to two minutes, so the server action only records the
 * request; the image is made after the response (next/server `after`), and the
 * card asks for the status until it is ready. A request whose server died
 * mid-way is called failed after STALE_MINUTES.
 */

export const PROVIDER = 'openai'
/** OpenAI's model for "workflows where editing precision matters most". */
export const MODEL = 'gpt-image-2.5-sunburst'
export const QUALITY = 'high'
const ENDPOINT = 'https://api.openai.com/v1/images/edits'

/** US dollars per million tokens, from developers.openai.com/api/docs/pricing (2026-11-04). */
export const RATES = { textInput: 5, imageInput: 8, output: 30 } as const

/** Longest edge asked of the model; his photos are 1568 on the long edge. */
export const OUTPUT_EDGE = 1536
const PRODUCT_EDGE = 1536
const CALL_TIMEOUT_MS = 4 * 60 * 1000
export const STALE_MINUTES = 6

export const TRY_ON_DIR = 'try-ons'

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
    case 'accessory':
      return { noun: 'accessory', how: 'worn the way it is meant to be worn' }
    default:
      return { noun: 'piece', how: 'in place of the matching piece he is wearing' }
  }
}

/**
 * The instruction. Image 1 is him, image 2 the product. What it asks for, in
 * order of what matters: him unchanged (proportions are what he is judging),
 * the garment exactly as sold (colour first, since colour is the point of the
 * app), then a believable fit. It asks for no flattery.
 */
export function tryOnPrompt(product: { title: string; garment_type: string | null; colour: string | null }): string {
  const { noun, how } = placement(product.garment_type)
  const colour = product.colour ? `, in ${product.colour}` : ''
  return [
    `Image 1 is a photo of a man. Image 2 is a shop's product photo of "${product.title}"${colour}.`,
    `Make a photograph of the man in image 1 wearing that exact ${noun} ${how}, so he can judge honestly whether to buy it.`,
    'Keep him exactly as he is: face, hair, skin tone, build, body shape, height and proportions, pose, expression, camera angle, lighting and background. Do not slim, lengthen, straighten or flatter him.',
    `Reproduce the ${noun} exactly as in image 2: the same colour and shade, shown under the light of image 1 without shifting its hue, brightness or saturation; the same fabric, texture, weight, pattern, cut, length, collar, buttons, pockets, stitching and hardware. Add nothing that is not in image 2: no logos, text or details.`,
    `Change nothing else he is wearing. If image 2 shows a model or other clothes, take only the ${noun}.`,
    'Let it fit and drape the way that cut would on his body, with natural creases and no smoothing.',
  ].join('\n')
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
  person: Buffer
  product: Buffer
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

/** One call to the image editor. `fetchImpl` is the seam the tests use. */
export async function editImage(request: EditRequest, fetchImpl: typeof fetch = fetch): Promise<EditResult> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new TryOnError('Try-on needs an OpenAI key: add OPENAI_API_KEY to the server’s environment.')
  const dataUrl = (bytes: Buffer) => `data:image/jpeg;base64,${bytes.toString('base64')}`

  let response: Response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        images: [{ image_url: dataUrl(request.person) }, { image_url: dataUrl(request.product) }],
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

/** Shopify's CDN resizes on a width parameter, and protocol-relative sources are common. */
export function productImageUrl(src: string, width = PRODUCT_EDGE): string {
  const url = new URL(src.startsWith('//') ? `https:${src}` : src)
  if (url.hostname.endsWith('cdn.shopify.com') || url.pathname.includes('/cdn/shop/')) {
    url.searchParams.set('width', String(width))
  }
  return url.toString()
}

/**
 * The product photo as a plain JPEG: the shop may serve WebP, PNG with
 * transparency or a 4000px original. Transparency goes onto white, as a shop
 * photo would sit.
 */
export async function fetchProductImage(src: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
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
  try {
    return await sharp(Buffer.from(await response.arrayBuffer()), { failOn: 'none' })
      .rotate()
      .resize({ width: PRODUCT_EDGE, height: PRODUCT_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer()
  } catch {
    throw new TryOnError('The shop’s photo could not be read.')
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
    select p.id::int as id, p.title, p.garment_type, p.images -> 0 ->> 'src' as image,
           (select s.colour_option from product_scores s where s.product_id = p.id
            order by s.scored_at desc limit 1) as colour
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

export type Started = { ok: true; id: number } | { ok: false; message: string }

/**
 * Record a request for one try-on. Refuses when there is no key, no
 * full-length photo, no product photo, or another try-on is still being made.
 */
export async function startTryOn(productId: number, sql: Sql = db()): Promise<Started> {
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

type Making = {
  id: number
  product_image: string
  prompt: string
  settings: { size?: string }
  photo_path: string
  photo_deleted: boolean
}

/**
 * Make the image for a recorded request and file it. Never throws: whatever
 * goes wrong ends as a failed row with words for the card.
 */
export async function makeTryOn(id: number, options: { sql?: Sql; fetch?: typeof fetch } = {}): Promise<TryOnStatus> {
  const sql = options.sql ?? db()
  const fetchImpl = options.fetch ?? fetch
  const [row] = await sql<Making[]>`
    select t.id::int as id, t.product_image, t.prompt, t.settings,
           ph.path as photo_path, ph.deleted_at is not null as photo_deleted
    from try_ons t join profile_photos ph on ph.id = t.photo_id
    where t.id = ${id} and t.status = 'making'
  `
  if (!row) return 'failed'

  try {
    if (row.photo_deleted) throw new TryOnError('The photo was deleted before it was made.')
    const [person, product] = await Promise.all([
      readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ photosDir(), row.photo_path)),
      fetchProductImage(row.product_image, fetchImpl),
    ])
    const [width, height] = (row.settings.size ?? `${OUTPUT_EDGE}x${OUTPUT_EDGE}`).split('x').map(Number)
    const result = await editImage(
      { person, product, prompt: row.prompt, size: { width: width!, height: height! } },
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
    await mkdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ photosDir(), TRY_ON_DIR), { recursive: true })
    await writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ photosDir(), relative), file.data)

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
      await unlink(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ photosDir(), relative)).catch(() => {})
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

/** The latest try-on of each of these products that is still kept. */
export async function latestTryOns(productIds: number[], sql: Sql = db()): Promise<Map<number, OnMe>> {
  if (productIds.length === 0) return new Map()
  const rows = await sql<(OnMe & { product_id: number })[]>`
    select distinct on (t.product_id) t.product_id::int as product_id, ${ON_ME_COLUMNS(sql)}
    from try_ons t join profile_photos ph on ph.id = t.photo_id
    where t.product_id = any (${productIds}::bigint[]) and t.deleted_at is null and ph.deleted_at is null
    order by t.product_id, t.started_at desc, t.id desc
  `
  return new Map(rows.map(({ product_id, ...onMe }) => [product_id, onMe]))
}

/** The image file of a ready try-on, or null. */
export async function tryOnFile(id: number, sql: Sql = db()): Promise<Buffer | null> {
  const [row] = await sql<{ path: string }[]>`
    select path from try_ons where id = ${id} and status = 'ready' and deleted_at is null and path is not null
  `
  if (!row) return null
  try {
    return await readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ photosDir(), row.path))
  } catch {
    return null
  }
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
