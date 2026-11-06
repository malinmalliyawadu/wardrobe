import type { TransactionSql } from 'postgres'
import { z } from 'zod'

import { db, type Sql } from './db.ts'
import { kitGarmentOf } from './finder/classify.ts'
import { hexDistance } from './finder/photo-colour.ts'
import type { ProductImage } from './finder/shopify.ts'
import { finish, text, type ParseResult } from './form-parse.ts'
import { photoChoices } from './product-photos.ts'
import { FITS, type Fit } from './profile-values.ts'
import { guideColours, type Guide } from './style-guide.ts'
import {
  GARMENT_GROUPS,
  GARMENT_TYPES,
  GYM_SHELF,
  WARMTHS,
  WORN_FOR,
  normaliseHex,
  type GarmentType,
  type PieceSource,
  type SlotStatus,
  type Warmth,
  type WornFor,
} from './wardrobe-values.ts'

/*
 * The wardrobe: the pieces Malin owns (migration 0006). The blueprint says
 * what he should own; this is what he has. The two meet in one rule, kept
 * here: a slot is owned exactly when a piece still in the wardrobe fills it.
 *
 * From the slot side, syncSlotPieces runs after anything that changes slot
 * statuses (a status tap, a redraft, a refill, "Bought it"): an owned slot
 * with no piece gets one made from the slot, and a piece whose slot is no
 * longer owned lets go of it. From the piece side, each change sets the slot
 * itself: linking a piece owns the slot; unlinking, setting aside or deleting
 * it hands the slot back.
 */

type Tx = Sql | TransactionSql

export type PiecePhoto = { id: number; width: number; height: number }

export type Piece = {
  id: number
  name: string
  garment_type: GarmentType
  colour_hex: string | null
  colour_name: string | null
  fabric: string | null
  fit: Fit | null
  warmth: Warmth | null
  /** Everyday looks, gym fits, or both (migration 0014). */
  worn_for: WornFor
  brand: string | null
  size: string | null
  notes: string | null
  slot_id: number | null
  slot_name: string | null
  slot_status: SlotStatus | null
  product_id: number | null
  product_url: string | null
  retailer: string | null
  /** The shop's photo, for a piece bought as a product and not photographed. */
  image: ProductImage | null
  photo: PiecePhoto | null
  source: PieceSource
  edited_at: Date | null
  set_aside_at: Date | null
  created_at: Date
}

export class PieceError extends Error {}

const SELECT = (sql: Tx) => sql`
  select p.id::int as id, p.name, p.garment_type, p.colour_hex, p.colour_name, p.fabric, p.fit,
         p.warmth, p.worn_for, p.brand, p.size, p.notes,
         p.slot_id::int as slot_id, s.name as slot_name, s.status as slot_status,
         p.product_id::int as product_id, pr.url as product_url, r.name as retailer,
         pr.main_image as image,
         case when ph.id is null then null
              else json_build_object('id', ph.id, 'width', ph.width, 'height', ph.height) end as photo,
         p.source, p.edited_at, p.set_aside_at, p.created_at
  from wardrobe_pieces p
  left join blueprint_slots s on s.id = p.slot_id
  left join products pr on pr.id = p.product_id
  left join retailers r on r.id = pr.retailer_id
  left join wardrobe_photos ph on ph.id = p.photo_id
`

/** Every piece, those still in the wardrobe first, in shelf order. */
export async function listPieces(sql: Tx = db()): Promise<Piece[]> {
  const rows = await sql<Piece[]>`
    ${SELECT(sql)}
    order by p.set_aside_at is not null, p.set_aside_at desc nulls first,
             array_position(${shelfOrder()}::text[], p.garment_type), lower(p.name), p.id
  `
  return rows
}

export async function getPiece(id: number, sql: Tx = db()): Promise<Piece | null> {
  const [row] = await sql<Piece[]>`${SELECT(sql)} where p.id = ${id}`
  return row ?? null
}

/** Garment types in the order the Pieces page shelves them. */
export function shelfOrder(): GarmentType[] {
  return GARMENT_GROUPS.flatMap((group) => group.types)
}

/**
 * The pieces still in the wardrobe, shelved by group, empty groups left out.
 * What he wears only to the gym is its own shelf, last; a piece worn for both
 * stays with its kind.
 */
export function shelve<T extends Pick<Piece, 'garment_type' | 'worn_for'>>(pieces: T[]): { title: string; pieces: T[] }[] {
  const everyday = pieces.filter((piece) => piece.worn_for !== 'gym')
  const gym = pieces.filter((piece) => piece.worn_for === 'gym')
  const order = shelfOrder()
  return [
    ...GARMENT_GROUPS.map((group) => ({
      title: group.title,
      pieces: everyday.filter((piece) => group.types.includes(piece.garment_type)),
    })),
    { title: GYM_SHELF, pieces: [...gym].sort((a, b) => order.indexOf(a.garment_type) - order.indexOf(b.garment_type)) },
  ].filter((group) => group.pieces.length > 0)
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Within this distance a read colour is taken to be the palette colour: about
 * what separates two dyes of "the same" navy, and less than daylight against
 * a warm lamp shifts a photo.
 */
export const SNAP_DISTANCE = 12

/**
 * A read colour as the wardrobe records it: the nearest guide colour when it
 * is close enough to be that colour, otherwise the colour itself.
 */
export function snapToGuide(
  hex: string,
  guide: Pick<Guide, 'palette'> | null,
): { hex: string; name: string | null; inPalette: boolean } {
  const value = normaliseHex(hex)
  if (!value) throw new Error(`not a hex colour: ${hex}`)
  if (!guide) return { hex: value, name: null, inPalette: false }
  let best: { hex: string; name: string; distance: number } | null = null
  for (const colour of guideColours(guide)) {
    const distance = hexDistance(value, colour.hex)
    if (!best || distance < best.distance) best = { hex: colour.hex, name: colour.name, distance }
  }
  return best && best.distance <= SNAP_DISTANCE
    ? { hex: best.hex, name: best.name, inPalette: true }
    : { hex: value, name: null, inPalette: false }
}

/** Whether a piece's colour is one of the guide's best colours or neutrals. */
export function inPalette(hex: string | null, guide: Pick<Guide, 'palette'> | null): boolean {
  return Boolean(hex && guide && guideColours(guide).some((colour) => colour.hex === hex))
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

const short = (max: number) => z.string().max(max).nullable()

export const PieceFormSchema = z.object({
  name: z.string().min(1).max(120),
  garment_type: z.enum(GARMENT_TYPES),
  colour_hex: z.string().regex(/^#[0-9a-f]{6}$/).nullable(),
  colour_name: short(60),
  fabric: short(80),
  fit: z.enum(FITS).nullable(),
  warmth: z.enum(WARMTHS).nullable(),
  worn_for: z.enum(WORN_FOR),
  brand: short(80),
  size: short(40),
  notes: short(1000),
  slot_id: z.number().int().positive().nullable(),
})

export type PieceValues = z.infer<typeof PieceFormSchema>

export function parsePieceForm(form: FormData): ParseResult<PieceValues> {
  const colour = text(form, 'colour_hex')
  const slot = text(form, 'slot_id')
  const slotId = slot === null ? null : Number(slot)
  const parsed = finish(PieceFormSchema, {
    name: text(form, 'name') ?? '',
    garment_type: text(form, 'garment_type'),
    colour_hex: colour === null ? null : (normaliseHex(colour) ?? colour),
    colour_name: text(form, 'colour_name'),
    fabric: text(form, 'fabric'),
    fit: text(form, 'fit'),
    warmth: text(form, 'warmth'),
    worn_for: text(form, 'worn_for') ?? 'everyday',
    brand: text(form, 'brand'),
    size: text(form, 'size'),
    notes: text(form, 'notes'),
    slot_id: slotId,
  })
  if (!parsed.ok) {
    const errors = { ...parsed.errors }
    if (errors.colour_hex) errors.colour_hex = 'Pick a colour'
    if (errors.garment_type) errors.garment_type = 'Choose what kind of piece it is'
    if (errors.worn_for) errors.worn_for = 'Choose what you wear it for'
    if (errors.slot_id) errors.slot_id = 'Choose a slot from the list'
    return { ok: false, errors }
  }
  return parsed
}

/** How a new piece came in, from the hidden fields of the add form. */
export type Origin = { source: PieceSource; photo_id: number | null; product_id: number | null }

export function parseOrigin(form: FormData): Origin | null {
  const source = text(form, 'source')
  if (source !== 'photo' && source !== 'link' && source !== 'typed') return null
  const id = (name: string) => {
    const value = Number(text(form, name))
    return Number.isInteger(value) && value > 0 ? value : null
  }
  const origin = { source, photo_id: id('photo_id'), product_id: id('product_id') } as Origin
  if (source === 'photo' && origin.photo_id === null) return null
  if (source === 'link' && origin.product_id === null) return null
  return origin
}

// ---------------------------------------------------------------------------
// Slots a piece can fill
// ---------------------------------------------------------------------------

export type OpenSlot = { id: number; name: string; garment_type: GarmentType; status: SlotStatus }

/**
 * The slots a piece may be linked to: every slot not retired and not already
 * filled by another piece still in the wardrobe. The piece's own slot stays
 * on the list.
 */
export async function fillableSlots(pieceId: number | null, sql: Tx = db()): Promise<OpenSlot[]> {
  return sql<OpenSlot[]>`
    select s.id::int as id, s.name, s.garment_type, s.status
    from blueprint_slots s
    where s.status <> 'retired'
      and not exists (
        select 1 from wardrobe_pieces p
        where p.slot_id = s.id and p.set_aside_at is null and p.id is distinct from ${pieceId}
      )
    order by s.priority, s.position, s.id
  `
}

async function assertFillable(tx: Tx, slotId: number, pieceId: number | null): Promise<void> {
  const slots = await fillableSlots(pieceId, tx)
  if (!slots.some((slot) => slot.id === slotId)) {
    throw new PieceError('That slot is retired or another piece already fills it.')
  }
}

/** A piece now fills the slot: the finder stops looking. */
async function ownSlot(tx: Tx, slotId: number): Promise<void> {
  await tx`update blueprint_slots set status = 'owned' where id = ${slotId} and status <> 'owned'`
}

/** The slot's piece has gone: back on the list, or out of the blueprint. */
async function releaseSlot(tx: Tx, slotId: number, to: 'wanted' | 'retired' = 'wanted'): Promise<void> {
  await tx`update blueprint_slots set status = ${to} where id = ${slotId} and status = 'owned'`
}

// ---------------------------------------------------------------------------
// Writes from the piece side
// ---------------------------------------------------------------------------

function valuesRow(values: PieceValues) {
  return {
    name: values.name,
    garment_type: values.garment_type,
    colour_hex: values.colour_hex,
    colour_name: values.colour_name,
    fabric: values.fabric,
    fit: values.fit,
    warmth: values.warmth,
    worn_for: values.worn_for,
    brand: values.brand,
    size: values.size,
    notes: values.notes,
    slot_id: values.slot_id,
  }
}

export async function createPiece(values: PieceValues, origin: Origin, sql: Sql = db()): Promise<number> {
  return sql.begin(async (tx) => {
    if (origin.photo_id !== null) {
      const [photo] = await tx`
        select 1 from wardrobe_photos ph
        where ph.id = ${origin.photo_id}
          and not exists (select 1 from wardrobe_pieces p where p.photo_id = ph.id)
      `
      if (!photo) throw new PieceError('That photo is gone or already belongs to a piece. Add it again.')
    }
    if (values.slot_id !== null) await assertFillable(tx, values.slot_id, null)
    const [row] = await tx<{ id: number }[]>`
      insert into wardrobe_pieces ${tx({ ...valuesRow(values), ...origin })}
      returning id::int as id
    `
    if (!row) throw new Error('piece insert returned nothing')
    if (values.slot_id !== null) await ownSlot(tx, values.slot_id)
    return row.id
  })
}

/** An edit makes the piece his: a slot it was made for no longer takes it away. */
export async function updatePiece(id: number, values: PieceValues, sql: Sql = db()): Promise<void> {
  await sql.begin(async (tx) => {
    const [current] = await tx<{ slot_id: number | null; set_aside_at: Date | null }[]>`
      select slot_id::int as slot_id, set_aside_at from wardrobe_pieces where id = ${id} for update
    `
    if (!current) throw new PieceError('That piece is gone.')
    const active = current.set_aside_at === null
    if (values.slot_id !== null && values.slot_id !== current.slot_id && active) {
      await assertFillable(tx, values.slot_id, id)
    }
    await tx`update wardrobe_pieces set ${tx({ ...valuesRow(values), edited_at: new Date() })} where id = ${id}`
    if (!active || values.slot_id === current.slot_id) return
    if (current.slot_id !== null) await releaseSlot(tx, current.slot_id)
    if (values.slot_id !== null) await ownSlot(tx, values.slot_id)
  })
}

/**
 * Worn out or given away. The piece stays, so a look that used it can say so.
 * A slot it filled goes back on the list, or is retired when he no longer
 * wants one.
 */
export async function setAside(id: number, slotTo: 'wanted' | 'retired', sql: Sql = db()): Promise<void> {
  await sql.begin(async (tx) => {
    const [piece] = await tx<{ slot_id: number | null }[]>`
      update wardrobe_pieces set set_aside_at = now()
      where id = ${id} and set_aside_at is null
      returning slot_id::int as slot_id
    `
    if (piece?.slot_id) await releaseSlot(tx, piece.slot_id, slotTo)
  })
}

/**
 * Back in the wardrobe, as an undo of setting it aside: it fills its slot
 * again, even one retired when it went, unless another piece has since.
 */
export async function restorePiece(id: number, sql: Sql = db()): Promise<void> {
  await sql.begin(async (tx) => {
    const [piece] = await tx<{ slot_id: number | null; taken: boolean }[]>`
      select p.slot_id::int as slot_id,
             exists (select 1 from wardrobe_pieces o where o.slot_id = p.slot_id and o.set_aside_at is null) as taken
      from wardrobe_pieces p where p.id = ${id} and p.set_aside_at is not null for update
    `
    if (!piece) return
    const slotId = piece.taken ? null : piece.slot_id
    await tx`update wardrobe_pieces set set_aside_at = null, slot_id = ${slotId} where id = ${id}`
    if (slotId !== null) await ownSlot(tx, slotId)
  })
}

/** Gone for good, photo and all. A slot it filled goes back on the list. */
export async function deletePiece(id: number, sql: Sql = db()): Promise<{ photoPath: string | null }> {
  return sql.begin(async (tx) => {
    const [piece] = await tx<{ slot_id: number | null; active: boolean; photo_id: number | null }[]>`
      delete from wardrobe_pieces where id = ${id}
      returning slot_id::int as slot_id, set_aside_at is null as active, photo_id::int as photo_id
    `
    if (!piece) return { photoPath: null }
    if (piece.slot_id !== null && piece.active) await releaseSlot(tx, piece.slot_id)
    if (piece.photo_id === null) return { photoPath: null }
    const [photo] = await tx<{ path: string }[]>`delete from wardrobe_photos where id = ${piece.photo_id} returning path`
    return { photoPath: photo?.path ?? null }
  })
}

// ---------------------------------------------------------------------------
// Writes from the slot side
// ---------------------------------------------------------------------------

/**
 * Holds the rule after slot statuses change. A piece that only stood in for
 * its slot (made from it, never edited, no photo) goes with the slot's
 * ownership; one he has edited or photographed stays, unlinked. Every owned
 * slot with no piece gets one made from the slot.
 */
export async function syncSlotPieces(tx: Tx): Promise<{ made: number; released: number }> {
  const released = await tx<{ id: number }[]>`
    with gone as (
      select p.id, p.source = 'slot' and p.edited_at is null and p.photo_id is null as placeholder
      from wardrobe_pieces p
      join blueprint_slots s on s.id = p.slot_id
      where p.set_aside_at is null and s.status <> 'owned'
    ),
    deleted as (
      delete from wardrobe_pieces where id in (select id from gone where placeholder) returning id
    ),
    unlinked as (
      update wardrobe_pieces set slot_id = null
      where id in (select id from gone where not placeholder) returning id
    )
    select id::int as id from deleted union all select id::int as id from unlinked
  `
  const made = await tx<{ id: number }[]>`
    insert into wardrobe_pieces (name, garment_type, colour_hex, colour_name, fabric, fit, worn_for, slot_id, source)
    select s.name, s.garment_type, lower(s.colours[1]), s.colour_family, s.fabrics[1], s.fit,
           case when s.garment_type = 'activewear' then 'gym' else 'everyday' end, s.id, 'slot'
    from blueprint_slots s
    where s.status = 'owned'
      and not exists (select 1 from wardrobe_pieces p where p.slot_id = s.id and p.set_aside_at is null)
    order by s.priority, s.position, s.id
    returning id::int as id
  `
  return { made: made.length, released: released.length }
}

/**
 * "Bought it" on a find: the product becomes a piece, with the shop's photo,
 * title and brand, the slot's colour and cloth, and the size that was in
 * stock. It takes the slot unless another piece he has kept fills it; a
 * placeholder made only from the slot gives way to the real thing. Runs
 * inside recordAction's transaction, before the slot is marked owned.
 */
export async function pieceFromPurchase(
  tx: Tx,
  input: { product_id: number; slot_id: number | null; size: string | null },
): Promise<number | null> {
  const [existing] = await tx<{ id: number }[]>`
    select id::int as id from wardrobe_pieces where product_id = ${input.product_id} and set_aside_at is null
  `
  if (existing) return existing.id

  const [product] = await tx<{ title: string; vendor: string | null; garment_type: GarmentType | null; image_colours: string[] | null; colour_option: string | null }[]>`
    select pr.title, pr.vendor, pr.garment_type, pr.image_colours,
           (select colour_option from product_scores sc
            where sc.product_id = pr.id and sc.colour_option is not null
            order by sc.scored_at desc limit 1) as colour_option
    from products pr where pr.id = ${input.product_id}
  `
  if (!product) return null
  const [slot] = input.slot_id
    ? await tx<{ status: SlotStatus; garment_type: GarmentType; colours: string[]; colour_family: string | null; fabrics: string[]; fit: Fit | null }[]>`
        select status, garment_type, colours, colour_family, fabrics, fit from blueprint_slots where id = ${input.slot_id}
      `
    : []
  const kit = asPiece(product.title, product.garment_type ?? slot?.garment_type ?? null)
  // Nothing says what kind of piece it is; he can add it by link instead.
  if (!kit.garment_type) return null

  let slotId: number | null = null
  if (slot && slot.status !== 'retired' && input.slot_id !== null) {
    await tx`
      delete from wardrobe_pieces
      where slot_id = ${input.slot_id} and set_aside_at is null
        and source = 'slot' and edited_at is null and photo_id is null
    `
    const [taken] = await tx`select 1 from wardrobe_pieces where slot_id = ${input.slot_id} and set_aside_at is null`
    if (!taken) slotId = input.slot_id
  }

  const [row] = await tx<{ id: number }[]>`
    insert into wardrobe_pieces ${tx({
      name: product.title,
      garment_type: kit.garment_type,
      worn_for: kit.worn_for,
      colour_hex: slot?.colours[0]?.toLowerCase() ?? product.image_colours?.[0] ?? null,
      colour_name: product.colour_option ?? slot?.colour_family ?? null,
      fabric: slot?.fabrics[0] ?? null,
      fit: slot?.fit ?? null,
      brand: product.vendor,
      size: input.size,
      slot_id: slotId,
      product_id: input.product_id,
      source: 'find',
    })}
    returning id::int as id
  `
  return row?.id ?? null
}

// ---------------------------------------------------------------------------
// Drafts: what the add form starts from
// ---------------------------------------------------------------------------

export type PieceDraft = {
  source: 'photo' | 'link' | 'typed'
  photo_id: number | null
  product_id: number | null
  values: Partial<PieceValues>
  /** A link's preview carries every photo it can show, to choose from (src/lib/product-photos.ts). */
  preview: { photo: PiecePhoto } | { image: ProductImage; title: string; photos: ProductImage[] } | null
  /** A line above the form when the read was partial. */
  note: string | null
}

/**
 * A product he pasted a link to, as the form's starting values: the shop's
 * title, brand and garment, and its colour from the main photo (read before
 * by the filter, or read now on our own server), snapped to the guide.
 */
export async function draftFromProduct(
  productId: number,
  guide: Pick<Guide, 'palette'> | null,
  readImage: (src: string) => Promise<string | null>,
  sql: Tx = db(),
): Promise<PieceDraft> {
  const [product] = await sql<{ title: string; vendor: string | null; garment_type: GarmentType | null; image: ProductImage | null; images: ProductImage[]; image_colours: string[] | null; colours: string[] }[]>`
    select pr.title, pr.vendor, pr.garment_type, pr.main_image as image, pr.images, pr.image_colours,
           coalesce(array_agg(distinct v.option_colour) filter (where v.option_colour is not null), '{}') as colours
    from products pr left join product_variants v on v.product_id = pr.id
    where pr.id = ${productId}
    group by pr.id
  `
  if (!product) throw new PieceError('That product could not be found.')
  const read = product.image_colours?.[0] ?? (product.image ? await readImage(product.image.src) : null)
  const kit = asPiece(product.title, product.garment_type)
  return {
    source: 'link',
    photo_id: null,
    product_id: productId,
    values: {
      name: product.title,
      garment_type: kit.garment_type ?? undefined,
      worn_for: kit.worn_for,
      colour_hex: read ? snapToGuide(read, guide).hex : null,
      colour_name: product.colours.length === 1 ? product.colours[0]!.toLowerCase() : null,
      brand: product.vendor,
    },
    preview: product.image ? { image: product.image, title: product.title, photos: photoChoices(product.images, product.image) } : null,
    note: product.colours.length > 1 ? `The shop sells it in ${product.colours.length} colours. Check the colour is yours.` : null,
  }
}

/**
 * A shop's garment as a piece he owns. Sport kit the finder filed as
 * activewear is named for what it is (a training tank is a tank) and worn for
 * the gym; one whose title names no garment stays activewear, for him to say.
 */
export function asPiece(title: string, garment: GarmentType | null): { garment_type: GarmentType | null; worn_for: WornFor } {
  if (garment !== 'activewear') return { garment_type: garment, worn_for: 'everyday' }
  return { garment_type: kitGarmentOf(title, null) ?? 'activewear', worn_for: 'gym' }
}

/** The piece in the wardrobe that fills a slot, if any. */
export async function pieceForSlot(slotId: number, sql: Tx = db()): Promise<{ id: number; name: string } | null> {
  const [row] = await sql<{ id: number; name: string }[]>`
    select id::int as id, name from wardrobe_pieces where slot_id = ${slotId} and set_aside_at is null
  `
  return row ?? null
}
