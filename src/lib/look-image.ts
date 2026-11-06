import { createHash } from 'node:crypto'
import path from 'node:path'

import sharp, { type OutputInfo } from 'sharp'

import { db, type Sql } from './db.ts'
import { lookOutfitKey, outfitKey } from './outfit-key.ts'
import { files } from './storage.ts'
import {
  editImage,
  fetchProductImage,
  lookForTryOn,
  MODEL,
  piecePhoto,
  placement,
  PROVIDER,
  QUALITY,
  showPieces,
  tryOnCost,
  TryOnError,
  type PieceSent,
} from './try-on.ts'

/*
 * A picture of a look without him: a menswear lookbook flat lay, drawn by
 * OpenAI from his own photo of each piece, else the shop's photo, else the
 * piece's description. Made for the outfit of the day's option on show, with
 * no tap (Malin's ask, 2026-11-05; the photo rule in docs/plan.md 1.1 says
 * which photos may go). His own photo is never sent: "See it on me" stays the
 * only way he is in a picture, and only on his tap.
 *
 * One picture per outfit, kept while its pieces and their photos stay the same
 * (pieces_key); a change, such as a photo added to a piece, makes a new one
 * the next time the look is on show. A picture is of the pieces, not of one
 * look (outfit_key, migration 0016): a look with the same pieces as one
 * already drawn, such as one made again after the first was dismissed, shows
 * that picture and is never drawn again. Files live in the file store under
 * looks/ and are served only through /photos/looks/:id.
 */

export const LOOK_IMAGE_DIR = 'looks'

/** Portrait, like a lookbook page and like the card it sits on. */
export const LOOK_IMAGE_SIZE = { width: 1152, height: 1536 } as const

/** A request left in the making by a server that died is called failed. */
const STALE_MINUTES = 6

export type LookImage = {
  id: number
  status: 'making' | 'ready' | 'failed'
  error: string | null
  width: number | null
  height: number | null
  usd: number | null
}

/** What the picture was made from, so a changed piece or photo is told apart. In the look's order. */
export function piecesKey(pieces: PieceSent[]): string {
  return pieces
    .map((piece) => {
      const shown = piece.shown.kind === 'photo' ? `photo:${piece.shown.photo_id}` : piece.shown.kind === 'product' ? `product:${piece.shown.src}` : 'words'
      return `${piece.piece_id}=${shown}|${piece.colour_hex ?? ''}`
    })
    .join(';')
}

/** Whether two pictures were drawn from the same pieces shown the same way, in whatever order. */
export function sameDrawing(a: PieceSent[], b: PieceSent[]): boolean {
  const byPiece = (pieces: PieceSent[]) => [...pieces].sort((x, y) => (x.piece_id ?? 0) - (y.piece_id ?? 0))
  return piecesKey(byPiece(a)) === piecesKey(byPiece(b))
}

/**
 * The instruction. The pieces with a photo are numbered from image 1 in the
 * look's order, outermost first; a piece with no photo is described in words.
 * What matters, in order: each piece exactly as it is (colour first, since
 * colour is the point of the app), nothing added, then a believable flat lay.
 */
export function lookImagePrompt(look: { title: string; styling: string | null; pieces: PieceSent[] }): string {
  let image = 0
  const lines = look.pieces.map((piece) => {
    const { noun } = placement(piece.garment_type)
    const colour = piece.colour_name && piece.colour_hex ? `${piece.colour_name} (${piece.colour_hex})` : (piece.colour_name ?? piece.colour_hex)
    if (piece.shown.kind === 'words') {
      const cloth = [piece.fit ? `${piece.fit} fit` : null, piece.fabric].filter(Boolean).join(', ')
      return `- No photo: "${piece.name}", the ${noun}${colour ? `, in ${colour}` : ''}${cloth ? `, ${cloth}` : ''}.`
    }
    image += 1
    return `- Image ${image}: "${piece.name}", the ${noun}${colour ? `, ${colour}` : ''}.`
  })
  const photos =
    image === 0
      ? null
      : image === 1
        ? "Image 1 is a photo of one of the pieces: his own, laid flat or on a hanger, or a shop's photo."
        : `Images 1 to ${image} are photos of the pieces: his own, laid flat or on a hanger, or a shop's photo.`
  return [
    photos,
    `Make a photograph of this whole outfit, "${look.title}", as a menswear lookbook flat lay, so a man can see how the pieces he owns look together. The pieces, from the outermost layer in:`,
    ...lines,
    look.styling ? `Lay it out the way it is worn: ${look.styling}` : null,
    'Arrange them as they would be worn, seen from directly above: the outer layer open over the top, the top above the trousers, the shoes at the foot, anything carried beside. Every piece whole and in frame, nothing overlapping so much that it is hidden.',
    'Reproduce each piece exactly as in its photo: the same colour and shade, without shifting its hue, brightness or saturation; the same fabric, texture, weight, pattern, cut, length, collar, buttons, pockets, stitching and hardware. Take only the garment from each photo, nothing of the bed, floor, hanger, model or other clothes around it. Make a piece given only in words plainly, in exactly that colour, with no pattern, logos or details that are not described. Add no logos, text or details anywhere.',
    'No person, no mannequin, no hangers. A plain warm off-white paper background, soft even daylight, a soft natural shadow under each piece, natural creases. Nothing else in the picture: no props, plants, jewellery or accessories that are not listed.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** A picture aliased `i` that is worth showing: ready, or still being made. */
const showable = (sql: Sql) => sql`
  (i.status = 'ready' or (i.status = 'making' and i.started_at >= now() - make_interval(mins => ${STALE_MINUTES})))
`

/**
 * The picture of each of these looks: drawn for it, or for another look with
 * the same pieces. One ready or being made before a failed one, then the
 * newest, which is the one of the pieces' photos as they are now.
 */
export async function latestLookImages(lookIds: number[], sql: Sql = db()): Promise<Map<number, LookImage>> {
  if (lookIds.length === 0) return new Map()
  const rows = await sql<(LookImage & { look_id: number })[]>`
    select distinct on (l.id) l.id::int as look_id, i.id::int as id,
           case when i.status = 'making' and i.started_at < now() - make_interval(mins => ${STALE_MINUTES})
                then 'failed' else i.status end as status,
           i.error, i.width, i.height, i.usd::float as usd
    from looks l
    join look_images i on i.look_id = l.id or i.outfit_key = ${lookOutfitKey(sql)}
    where l.id in ${sql(lookIds)}
    order by l.id, ${showable(sql)} desc, i.started_at desc, i.id desc
  `
  return new Map(rows.map(({ look_id, ...image }) => [look_id, image]))
}

/**
 * Records a picture of a look in the making, unless there is one of its
 * pieces as they are now (ready, or being made), drawn for it or for another
 * look with the same pieces; or there is no OpenAI key, or a piece has gone
 * from the wardrobe. Returns the id to make, or null for nothing to do. Never
 * throws for a missing key: the card then shows the pieces laid out.
 */
export async function startLookImage(lookId: number, sql: Sql = db()): Promise<number | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const look = await lookForTryOn(sql, lookId)
  if (!look || look.pieces.length === 0 || look.pieces.length < look.piece_count) return null
  const pieces = showPieces(look.pieces)
  const outfit = outfitKey(pieces)

  await sql`
    update look_images set status = 'failed', finished_at = now(), error = 'It took too long.'
    where status = 'making' and started_at < now() - make_interval(mins => ${STALE_MINUTES})
  `
  const drawn = await sql<{ pieces: PieceSent[] }[]>`
    select pieces from look_images
    where (look_id = ${lookId} or outfit_key = ${outfit}) and status in ('making', 'ready')
  `
  if (drawn.some((image) => sameDrawing(image.pieces, pieces))) return null
  try {
    const [row] = await sql<{ id: number }[]>`
      insert into look_images ${sql({
        look_id: lookId,
        outfit_key: outfit,
        pieces: sql.json(pieces),
        pieces_key: piecesKey(pieces),
        provider: PROVIDER,
        model: MODEL,
        prompt: lookImagePrompt({ title: look.title, styling: look.styling, pieces }),
        settings: sql.json({ size: `${LOOK_IMAGE_SIZE.width}x${LOOK_IMAGE_SIZE.height}`, quality: QUALITY }),
      })}
      returning id::int as id
    `
    return row!.id
  } catch (error) {
    // Another tab started the same picture a moment ago.
    if ((error as { code?: string }).code === '23505') return null
    throw error
  }
}

/** Makes a recorded picture and files it. Never throws: a failure ends as a failed row. */
export async function makeLookImage(id: number, options: { sql?: Sql; fetch?: typeof fetch } = {}): Promise<'ready' | 'failed'> {
  const sql = options.sql ?? db()
  const fetchImpl = options.fetch ?? fetch
  const [row] = await sql<{ id: number; pieces: PieceSent[]; prompt: string }[]>`
    select id::int as id, pieces, prompt from look_images where id = ${id} and status = 'making'
  `
  if (!row) return 'failed'
  const started = Date.now()
  try {
    const images = await Promise.all(
      row.pieces.flatMap((piece) => {
        if (piece.shown.kind === 'photo') return [piecePhoto(sql, piece.shown.photo_id)]
        if (piece.shown.kind === 'product') return [fetchProductImage(piece.shown.src, fetchImpl)]
        return []
      }),
    )
    const result = await editImage({ images, prompt: row.prompt, size: LOOK_IMAGE_SIZE }, fetchImpl)

    // Re-encoded through sharp like every stored picture, which drops any metadata.
    let file: { data: Buffer; info: OutputInfo }
    try {
      file = await sharp(result.image, { failOn: 'none' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    } catch {
      throw new TryOnError('OpenAI sent back an image that could not be read.')
    }
    const name = `${id}-${createHash('sha256').update(file.data).digest('hex').slice(0, 16)}.jpg`
    const relative = path.posix.join(LOOK_IMAGE_DIR, name)
    await files().put(relative, file.data, 'image/jpeg')

    const usage = result.usage
    await sql`
      update look_images set
        status = 'ready', path = ${relative}, width = ${file.info.width}, height = ${file.info.height},
        request_id = ${result.requestId}, usage = ${usage ? sql.json(usage) : null},
        input_tokens = ${usage?.input_tokens ?? null}, output_tokens = ${usage?.output_tokens ?? null},
        usd = ${usage ? tryOnCost(usage) : null}, finished_at = now()
      where id = ${id} and status = 'making'
    `
    console.info(JSON.stringify({ event: 'look_image.ready', id, usd: usage ? tryOnCost(usage) : null, ms: Date.now() - started }))
    return 'ready'
  } catch (error) {
    if (!(error instanceof TryOnError)) console.error('look image: failed', error)
    const message = error instanceof TryOnError ? error.message : 'Something went wrong drawing it.'
    console.warn(JSON.stringify({ event: 'look_image.failed', id, message }))
    await sql`
      update look_images set status = 'failed', error = ${message}, finished_at = now()
      where id = ${id} and status = 'making'
    `
    return 'failed'
  }
}

/** Starts and makes the picture of a look if it needs one. For `after()`; never throws. */
export async function ensureLookImage(lookId: number, sql: Sql = db()): Promise<void> {
  try {
    const id = await startLookImage(lookId, sql)
    if (id !== null) await makeLookImage(id, { sql })
  } catch (error) {
    console.error('look image: could not start', error)
  }
}

/** The file of a ready picture, or null. */
export async function lookImageFile(id: number, sql: Sql = db()): Promise<Buffer | null> {
  const [row] = await sql<{ path: string }[]>`
    select path from look_images where id = ${id} and status = 'ready' and path is not null
  `
  if (!row) return null
  return files().get(row.path)
}
