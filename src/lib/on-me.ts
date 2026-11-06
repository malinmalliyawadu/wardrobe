import { db, type Sql } from './db.ts'
import type { ProductImage } from './finder/shopify.ts'
import { OCCASION_LABELS, type Occasion } from './looks.ts'
import { listPieces, type PiecePhoto } from './pieces.ts'
import { STALE_MINUTES, findColour, showableTryOn, type PieceSent } from './try-on.ts'
import { GARMENT_TYPES, type GarmentType, type WornFor } from './wardrobe-values.ts'

/*
 * The On me page: every picture of him OpenAI made, newest first, each with
 * what it was made from (his photo, and the find, the look's pieces or the
 * pieces he chose), and the choices for a new one of his own pieces and
 * saved finds. A picture lives until "delete photos" takes it; a failed
 * request has no picture, so it is not shown.
 */

/** One thing a picture was made from, as it was sent, with where it lives now. */
export type Source = {
  key: string
  name: string
  garment_type: GarmentType | null
  colour_hex: string | null
  colour_name: string | null
  /** His own photo of the piece, while it is kept. */
  photo: PiecePhoto | null
  /** The shop's photo that was sent. */
  image: ProductImage | null
  /** How it reached OpenAI: his photo, the shop's photo, or only in words. */
  shown: 'photo' | 'product' | 'words'
  /** One of his pieces, a find he saved and chose, or the find a "See it on me" was tapped on. */
  kind: 'piece' | 'saved' | 'find'
  /** The piece's page or the shop's, while it is still there. */
  href: string | null
}

export type Subject =
  | { kind: 'find'; title: string; retailer: string | null }
  | { kind: 'look'; title: string; occasion: string | null }
  | { kind: 'outfit'; title: string; count: number }

export type OnMeImage = {
  id: number
  status: 'making' | 'ready'
  width: number | null
  height: number | null
  usd: number | null
  started_at: Date
  /** His full-length photo it was made from. */
  photo_id: number
  photo_taken: Date
  subject: Subject
  sources: Source[]
}

export type OnMeDetail = OnMeImage & { prompt: string; model: string; size: string | null }

type Row = {
  id: number
  status: 'making' | 'ready'
  width: number | null
  height: number | null
  usd: number | null
  started_at: Date
  photo_id: number
  photo_taken: Date
  prompt: string
  model: string
  size: string | null
  product_id: number | null
  product_image: string | null
  product_title: string | null
  product_url: string | null
  product_garment: string | null
  retailer: string | null
  look_id: number | null
  look_title: string | null
  look_occasion: Occasion | null
  pieces: PieceSent[] | null
}

const SELECT = (sql: Sql) => sql`
  select t.id::int as id, t.status, t.width, t.height, t.usd::float as usd, t.started_at,
         t.photo_id::int as photo_id, ph.created_at as photo_taken,
         t.prompt, t.model, t.settings ->> 'size' as size,
         t.product_id::int as product_id, t.product_image, pr.title as product_title, pr.url as product_url,
         pr.garment_type as product_garment, r.name as retailer,
         t.look_id::int as look_id, l.title as look_title, l.occasion as look_occasion,
         t.pieces
  from try_ons t
  join profile_photos ph on ph.id = t.photo_id and ph.deleted_at is null
  left join products pr on pr.id = t.product_id
  left join retailers r on r.id = pr.retailer_id
  left join looks l on l.id = t.look_id
  where t.deleted_at is null
    and (t.status = 'ready'
         or (t.status = 'making' and t.started_at >= now() - make_interval(mins => ${STALE_MINUTES})))
`

/** Every picture still kept, and any being made, newest first. */
export async function listOnMe(sql: Sql = db()): Promise<OnMeImage[]> {
  const rows = await sql<Row[]>`${SELECT(sql)} order by t.started_at desc, t.id desc`
  return resolve(sql, rows)
}

/** One picture with what was asked of OpenAI. */
export async function getOnMe(id: number, sql: Sql = db()): Promise<OnMeDetail | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} and t.id = ${id}`
  const [detail] = await resolve(sql, rows)
  return detail ?? null
}

function garment(value: string | null | undefined): GarmentType | null {
  return value && (GARMENT_TYPES as readonly string[]).includes(value) ? (value as GarmentType) : null
}

/** "Ink Wool Overshirt, Grey tee and Putty chinos" */
export function outfitTitle(names: string[]): string {
  if (names.length === 0) return 'Your choice'
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * The rows with their sources looked up as they are now: which pieces are
 * still in the wardrobe, which of his piece photos are still kept, and where
 * a find lives and whether it is still saved, in three queries for the whole page.
 */
async function resolve(sql: Sql, rows: Row[]): Promise<OnMeDetail[]> {
  const sent = rows.flatMap((row) => row.pieces ?? [])
  const pieceIds = [...new Set(sent.flatMap((piece) => (piece.piece_id !== null ? [piece.piece_id] : [])))]
  const photoIds = [...new Set(sent.flatMap((piece) => (piece.shown.kind === 'photo' ? [piece.shown.photo_id] : [])))]
  const productIds = [...new Set(sent.flatMap((piece) => (piece.piece_id === null && piece.product_id ? [piece.product_id] : [])))]

  const [pieces, photos, products] = await Promise.all([
    pieceIds.length === 0 ? [] : sql<{ id: number }[]>`select id::int as id from wardrobe_pieces where id = any (${pieceIds}::bigint[])`,
    photoIds.length === 0
      ? []
      : sql<PiecePhoto[]>`select id::int as id, width, height from wardrobe_photos where id = any (${photoIds}::bigint[])`,
    productIds.length === 0
      ? []
      : sql<{ id: number; url: string; saved: boolean }[]>`
          select p.id::int as id, p.url,
                 coalesce((select a.action = 'saved' from feed_actions a where a.product_id = p.id
                           order by a.created_at desc, a.id desc limit 1), false) as saved
          from products p where p.id = any (${productIds}::bigint[])
        `,
  ])
  const kept = new Set(pieces.map((piece) => piece.id))
  const photoById = new Map(photos.map((photo) => [photo.id, photo]))
  const urlById = new Map(products.map((product) => [product.id, product.url]))
  const saved = new Set(products.flatMap((product) => (product.saved ? [product.id] : [])))

  return rows.map((row) => {
    const base = {
      id: row.id,
      status: row.status,
      width: row.width,
      height: row.height,
      usd: row.usd,
      started_at: row.started_at,
      photo_id: row.photo_id,
      photo_taken: row.photo_taken,
      prompt: row.prompt,
      model: row.model,
      size: row.size,
    }
    if (row.product_id !== null) {
      const source: Source = {
        key: `f${row.product_id}`,
        name: row.product_title ?? 'The find',
        garment_type: garment(row.product_garment),
        colour_hex: null,
        colour_name: null,
        photo: null,
        image: row.product_image ? { src: row.product_image, width: null, height: null, alt: null } : null,
        shown: 'product',
        kind: 'find',
        href: row.product_url,
      }
      return { ...base, subject: { kind: 'find', title: source.name, retailer: row.retailer }, sources: [source] }
    }

    const sources = (row.pieces ?? []).map((piece, index): Source => {
      const owned = piece.piece_id !== null
      const href = owned
        ? kept.has(piece.piece_id!) ? `/wardrobe/${piece.piece_id}` : null
        : piece.product_id ? (urlById.get(piece.product_id) ?? null) : null
      return {
        key: owned ? `p${piece.piece_id}` : piece.product_id ? `f${piece.product_id}` : `x${index}`,
        name: piece.name,
        garment_type: garment(piece.garment_type),
        colour_hex: piece.colour_hex,
        colour_name: piece.colour_name,
        photo: piece.shown.kind === 'photo' ? (photoById.get(piece.shown.photo_id) ?? null) : null,
        image: piece.shown.kind === 'product' ? { src: piece.shown.src, width: null, height: null, alt: null } : null,
        shown: piece.shown.kind,
        // A statement piece goes on without being saved, and a saved find may have been cleared since.
        kind: owned ? 'piece' : piece.product_id && saved.has(piece.product_id) ? 'saved' : 'find',
        href,
      }
    })
    const subject: Subject =
      row.look_id !== null
        ? { kind: 'look', title: row.look_title ?? 'A look', occasion: row.look_occasion ? OCCASION_LABELS[row.look_occasion] : null }
        : { kind: 'outfit', title: outfitTitle(sources.map((source) => source.name)), count: sources.length }
    return { ...base, subject, sources }
  })
}

// ---------------------------------------------------------------------------
// Choosing pieces for a new one
// ---------------------------------------------------------------------------

/** Something he can put on: one of his pieces or a find he saved. */
export type Choice = {
  /** "p12" for a piece, "f34" for a saved find; what the form posts. */
  key: string
  id: number
  name: string
  /** The shop, for a saved find. */
  retailer: string | null
  garment_type: GarmentType | null
  /** What a piece is worn for, so gym kit shelves apart; null for a find. */
  worn_for: WornFor | null
  colour_hex: string | null
  colour_name: string | null
  photo: PiecePhoto | null
  image: ProductImage | null
}

export type Choices = { pieces: Choice[]; finds: Choice[] }

/**
 * Each outfit already put on him, by outfitKey, and the picture to open for
 * it (ready before one in the making, then the newest): the chooser offers
 * that picture, not a new one, when what he ticked is one of these.
 */
export async function keptOutfits(sql: Sql = db()): Promise<Record<string, number>> {
  const rows = await sql<{ outfit_key: string; id: number }[]>`
    select distinct on (t.outfit_key) t.outfit_key, t.id::int as id
    from try_ons t join profile_photos ph on ph.id = t.photo_id and ph.deleted_at is null
    where t.deleted_at is null and ${showableTryOn(sql)}
    order by t.outfit_key, t.status = 'ready' desc, t.started_at desc, t.id desc
  `
  return Object.fromEntries(rows.map((row) => [row.outfit_key, row.id]))
}

/** His pieces still in the wardrobe, in shelf order, and his saved finds, newest first. */
export async function outfitChoices(sql: Sql = db()): Promise<Choices> {
  const [pieces, finds] = await Promise.all([
    listPieces(sql),
    sql<(Omit<Choice, 'key' | 'colour_hex' | 'photo' | 'garment_type' | 'worn_for'> & { garment_type: string | null })[]>`
      with latest_action as (
        select distinct on (product_id) product_id, slot_id, action, created_at
        from feed_actions order by product_id, created_at desc, id desc
      )
      select p.id::int as id, p.title as name, r.name as retailer,
             coalesce(p.garment_type, bs.garment_type) as garment_type,
             ${findColour(sql)} as colour_name,
             p.main_image as image
      from latest_action a
      join products p on p.id = a.product_id
      join retailers r on r.id = p.retailer_id
      left join blueprint_slots bs on bs.id = a.slot_id
      where a.action = 'saved'
      order by a.created_at desc
    `,
  ])
  return {
    pieces: pieces
      .filter((piece) => !piece.set_aside_at)
      .map((piece) => ({
        key: `p${piece.id}`,
        id: piece.id,
        name: piece.name,
        retailer: null,
        garment_type: piece.garment_type,
        worn_for: piece.worn_for,
        colour_hex: piece.colour_hex,
        colour_name: piece.colour_name,
        photo: piece.photo,
        image: piece.image,
      })),
    finds: finds.map((find) => ({
      ...find,
      key: `f${find.id}`,
      garment_type: garment(find.garment_type),
      worn_for: null,
      colour_hex: null,
      photo: null,
    })),
  }
}
