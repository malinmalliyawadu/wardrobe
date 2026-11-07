import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { MODELS, callUsd, claude } from './claude.ts'
import { db, type Sql } from './db.ts'
import { readPhoto } from './finder/photo-colour.ts'
import { snapToGuide, type PieceValues } from './pieces.ts'
import { checkUpload, normaliseImage, PhotoError, removePair, storePair, thumbName } from './photos.ts'
import { FITS } from './profile-values.ts'
import { finalText, plainDashes } from './structured.ts'
import { guideColours, type Guide } from './style-guide.ts'
import { files } from './storage.ts'
import { PIECE_GARMENT_TYPES, WARMTHS } from './wardrobe-values.ts'

/*
 * Photos of his clothes. Stored like his own photos (src/lib/photos.ts): a
 * metadata-free master and thumb in the file store, under wardrobe/, served
 * only through /photos/wardrobe/:id. Agreed with Malin on 2026-11-04: a photo
 * of a piece goes to Claude (Sonnet) once, when he adds it, to fill in the
 * form he then checks, and the looks are made from the pieces' words, not
 * their photos. It goes to OpenAI only for a try-on of a look he taps for
 * (src/lib/try-on.ts). The colour is also read on our own server, which sends
 * nothing anywhere.
 */

export const PIECE_DIR = 'wardrobe'

/** A photo nobody saved a piece for is cleared after this long. */
const ORPHAN_HOURS = 24

export type StoredPiecePhoto = { id: number; path: string; width: number; height: number; colourHex: string | null }

export async function storePiecePhoto(input: { bytes: Buffer; mime: string }, sql: Sql = db()): Promise<StoredPiecePhoto> {
  checkUpload(input)
  const { master, thumb, sha256 } = await normaliseImage(input.bytes)
  const relative = `${PIECE_DIR}/${sha256.slice(0, 24)}.jpg`
  const read = await readPhoto(master.data)

  await storePair(relative, master.data, thumb)

  const colourRead = { hex: read.hex, colours: read.colours, share: Number(read.share.toFixed(3)), foreground: Number(read.foreground.toFixed(3)) }
  const [row] = await sql<{ id: number }[]>`
    insert into wardrobe_photos (path, bytes, width, height, sha256, colour_read)
    values (${relative}, ${master.info.size}, ${master.info.width}, ${master.info.height}, ${sha256}, ${sql.json(colourRead)})
    on conflict (path) do update set colour_read = excluded.colour_read
    returning id::int as id
  `
  if (!row) throw new Error('photo insert returned nothing')
  await clearOrphans(sql)
  return { id: row.id, path: relative, width: master.info.width, height: master.info.height, colourHex: read.hex }
}

/** Photos read for a piece he never saved. */
export async function clearOrphans(sql: Sql = db()): Promise<number> {
  const rows = await sql<{ path: string }[]>`
    delete from wardrobe_photos ph
    where ph.created_at < now() - make_interval(hours => ${ORPHAN_HOURS})
      and not exists (select 1 from wardrobe_pieces p where p.photo_id = ph.id)
    returning path
  `
  await Promise.all(rows.map((row) => removePair(row.path)))
  return rows.length
}

export async function piecePhotoFile(id: number, variant: 'master' | 'thumb', sql: Sql = db()): Promise<Buffer | null> {
  const [row] = await sql<{ path: string }[]>`select path from wardrobe_photos where id = ${id}`
  if (!row) return null
  return files().get(variant === 'thumb' ? thumbName(row.path) : row.path)
}

/** A new photo for a piece he already has. The old one goes. */
export async function attachPhoto(pieceId: number, photoId: number, sql: Sql = db()): Promise<void> {
  const old = await sql.begin(async (tx) => {
    const [piece] = await tx<{ photo_id: number | null }[]>`
      select photo_id::int as photo_id from wardrobe_pieces where id = ${pieceId} for update
    `
    if (!piece) return null
    if (piece.photo_id === photoId) return null
    await tx`update wardrobe_pieces set photo_id = ${photoId}, edited_at = now() where id = ${pieceId}`
    if (piece.photo_id === null) return null
    const [gone] = await tx<{ path: string }[]>`delete from wardrobe_photos where id = ${piece.photo_id} returning path`
    return gone?.path ?? null
  })
  if (old) await removePair(old)
}

// ---------------------------------------------------------------------------
// Claude's read
// ---------------------------------------------------------------------------

export const PieceReadSchema = z.object({
  is_garment: z
    .boolean()
    .describe('False when the photo does not show one piece of menswear clearly enough to describe.'),
  name: z
    .string()
    .describe('What he would call it, colour first, under 6 words, no brand: "Ink navy merino crewneck".'),
  garment_type: z
    .enum(PIECE_GARMENT_TYPES)
    .describe('What it is as a garment, sport kit included: a gym tank is a tank, running shorts are shorts, training shoes are sneakers.'),
  gym_kit: z
    .boolean()
    .describe('True when it is made to train in: technical or sweat-wicking cloth, a sport cut, a training shoe. False for everyday clothes.'),
  colour_words: z.string().describe('The colour in plain words, as a tailor would name it: "ink navy", "washed black".'),
  palette_hex: z
    .string()
    .nullable()
    .describe('The hex of the palette colour this piece is, copied exactly from the list, when it is that colour or very close; null when it is none of them.'),
  fabric: z.string().nullable().describe('The cloth as it looks: "merino", "selvedge denim", "brushed cotton". Null when you cannot tell.'),
  fit: z.enum(FITS).nullable().describe('The cut, when the photo shows it; null for shoes, accessories and when you cannot tell.'),
  warmth: z
    .enum(WARMTHS)
    .describe(
      'light: comfortable on a warm day (a cotton or linen tee, shirt or shorts, a thin shell); mid: for a mild or cool day (a cotton knit or sweatshirt, an overshirt, denim, a light jacket); warm: for a cold day (wool or cashmere knits, fleece, flannel, a lined or wool coat).',
    ),
  brand: z.string().nullable().describe('Only when a label or logo is legible in the photo; otherwise null.'),
  notes: z
    .string()
    .nullable()
    .describe('One detail that matters for putting outfits together, a few words: "button-down collar", "contrast stitching". Null if none.'),
})

export type PieceRead = z.infer<typeof PieceReadSchema>

export class PieceReadError extends Error {}

export const PIECE_READ_SYSTEM_PROMPT = `You are an experienced menswear stylist cataloguing one client's wardrobe. He has photographed one piece he owns, laid flat, on a hanger or on him, often on a bed or a floor in indoor light. Fill in its record for him to check: what it is, its colour, cloth, cut and how warm it is. A private app keeps the record and later puts outfits together from his pieces, so be accurate and plain rather than flattering.

Colour matters most. Judge the garment's own colour, allowing for the light in the photo (warm lamps make navy look brown and white look cream). When the colour is one of his palette colours, or close enough that he would call it that, give that hex exactly as listed; when it is none of them, give null and name the colour in words.

When the photo is not of a single piece of menswear (a room, a person with nothing in particular, several garments in a pile), set is_garment to false and fill the rest as best you can.`

export function buildReadRequest(base64: string, guide: Pick<Guide, 'palette'> | null) {
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
  const { parse: _parse, ...format } = zodOutputFormat(PieceReadSchema)
  return {
    model: MODELS.piece,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: PIECE_READ_SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content }],
    output_config: { effort: 'low' as const, format },
  }
}

/** One Sonnet call. The read and its cost are kept on the photo's row. */
export async function readPiecePhoto(photo: StoredPiecePhoto, guide: Pick<Guide, 'palette'> | null, sql: Sql = db()): Promise<PieceRead> {
  const bytes = await files().get(photo.path)
  if (!bytes) throw new PhotoError('That photo is missing its file. Add it again.')
  const base64 = bytes.toString('base64')
  const response = await claude().beta.messages.create(buildReadRequest(base64, guide), { maxRetries: 3 })
  const usd = callUsd(MODELS.piece, response.usage)
  const meta = {
    model: MODELS.piece,
    served_by: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    read_at: new Date().toISOString(),
  }

  let read: PieceRead | null = null
  let failure: string | null = null
  if (response.stop_reason === 'refusal') failure = 'Claude declined to read that photo.'
  else if (response.stop_reason === 'max_tokens') failure = 'The read was cut off.'
  else {
    const parsed = PieceReadSchema.safeParse(plainDashes(parseJson(finalText(response.content))))
    if (parsed.success) read = parsed.data
    else failure = 'Claude answered in a shape the app did not expect.'
  }
  await sql`
    update wardrobe_photos set read = ${sql.json({ ...(read ?? { failure }), meta })}, read_usd = ${usd}
    where id = ${photo.id}
  `
  if (!read) throw new PieceReadError(failure ?? 'The read failed.')
  return read
}

/**
 * The form's starting values from a read. The palette colour Claude named
 * wins when it is really in the guide; otherwise the colour read on our own
 * server, snapped to the guide when it is close.
 */
export function valuesFromRead(
  read: PieceRead | null,
  localHex: string | null,
  guide: Pick<Guide, 'palette'> | null,
): Partial<PieceValues> {
  const named = read?.palette_hex?.toLowerCase() ?? null
  const fromPalette = named && guide && guideColours(guide).some((colour) => colour.hex === named) ? named : null
  const colour = fromPalette ?? (localHex ? snapToGuide(localHex, guide).hex : null)
  if (!read) return { colour_hex: colour }
  return {
    name: sentence(read.name),
    garment_type: read.garment_type,
    colour_hex: colour,
    colour_name: read.colour_words.toLowerCase(),
    fabric: read.fabric?.toLowerCase() ?? null,
    fit: read.fit,
    warmth: read.warmth,
    worn_for: read.gym_kit ? 'gym' : 'everyday',
    brand: read.brand,
    notes: read.notes,
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
