import type postgres from 'postgres'

import { db, type Sql } from './db.ts'
import { getLooks, type Look } from './looks.ts'
import { listPieces, type Piece } from './pieces.ts'

/*
 * What gets worn and what only gets offered, asked for by Malin on 2026-11-07
 * so he can start discarding outfits and pieces. Nothing new is recorded: an
 * offer is a set of looks a look was in or a day it was on Today (the
 * look_offers view, migration 0022), and a wear is a look_wears row. A piece
 * is offered when a look wearing it is, and worn on a day a look wearing it
 * was; a day or a set counts once for a piece, however many of its looks wore
 * it. Wears of looks since dismissed or remade still count for their pieces,
 * since he did wear them.
 *
 * Both lists put first what he passes over most: offered the most times more
 * than it was worn, then the least worn, then the longest since it was.
 *
 * Pieces to rotate out are picked by a rule the page states, so the list is
 * never a mystery (rotateOut): offered at least ROTATE_OFFERS times and worn
 * on at most one offer in four, or owned NEVER_DAYS days since looks began
 * with no look wearing it.
 */

/** Offers before a piece's wear rate says anything. */
export const ROTATE_OFFERS = 3
/** Days in the wardrobe, counted from when looks began, before a piece no look wears is one to rotate out. */
export const NEVER_DAYS = 14


export type PieceWear = {
  offered: number
  /** The looks it was offered in, whatever became of them. */
  looks: number
  /** Days he wore a look with it in. */
  worn: number
  /** YYYY-MM-DD in New Zealand. */
  last_worn: string | null
}

export type WornPiece = Piece & { wear: PieceWear }

export type WearPage = {
  /** The day the first look was offered, in New Zealand, as YYYY-MM-DD. */
  since: string | null
  /** Days he wore any look. */
  days_worn: number
  /** Pieces to rotate out (rotateOut), most passed over first, then those no look wears. */
  rotate: WornPiece[]
  /** Looks he saved, most passed over first. */
  saved: Look[]
  /** The rest of the pieces in the wardrobe that a look has worn, most passed over first. */
  pieces: WornPiece[]
  /** The rest of the pieces in the wardrobe no look has worn yet, the longest owned first. */
  never: WornPiece[]
  /** Looks offered and neither saved nor dismissed, most passed over first. */
  offered: Look[]
}

const NONE: PieceWear = { offered: 0, looks: 0, worn: 0, last_worn: null }

type Ranked = { offered: number; worn: number; last_worn: string | null; id: number }

/** Offered the most times more than worn first, then the least worn, then the longest since. */
export function byPassedOver(a: Ranked, b: Ranked): number {
  const passed = (x: Ranked) => Math.max(0, x.offered - x.worn)
  return (
    passed(b) - passed(a) ||
    a.worn - b.worn ||
    (a.last_worn ?? '').localeCompare(b.last_worn ?? '') ||
    b.offered - a.offered ||
    a.id - b.id
  )
}

/**
 * Whether a piece is one to rotate out: offered enough to tell and worn on at
 * most a quarter of its offers, or never in a look after NEVER_DAYS in the
 * wardrobe while looks were being made. `since` is when looks began.
 */
export function rotateOut(wear: PieceWear, createdAt: Date, since: string | null, now: Date = new Date()): boolean {
  if (wear.offered >= ROTATE_OFFERS) return wear.worn * 4 <= wear.offered
  if (wear.offered > 0 || wear.worn > 0 || !since) return false
  const from = Math.max(createdAt.getTime(), new Date(`${since}T00:00:00+13:00`).getTime())
  return now.getTime() - from >= NEVER_DAYS * 24 * 3600 * 1000
}

const lookRank = (look: Look): Ranked => ({ offered: look.offered, worn: look.worn.length, last_worn: look.worn[0] ?? null, id: look.id })

/** How often each piece, or the pieces asked for, was offered and worn. A piece no look has worn is missing. */
export async function pieceWear(sql: Sql = db(), ids?: number[]): Promise<Map<number, PieceWear>> {
  const only: postgres.Fragment = ids ? sql`and lp.piece_id in ${sql(ids.length > 0 ? ids : [0])}` : sql``
  const rows = await sql<(PieceWear & { piece_id: number })[]>`
    select lp.piece_id::int as piece_id,
           (select count(distinct o.offer)::int from look_pieces x join look_offers o on o.look_id = x.look_id where x.piece_id = lp.piece_id) as offered,
           count(distinct lp.look_id) filter (where l.status <> 'replaced')::int as looks,
           (select count(distinct w.worn_on)::int from look_pieces x join look_wears w on w.look_id = x.look_id where x.piece_id = lp.piece_id) as worn,
           (select to_char(max(w.worn_on), 'YYYY-MM-DD') from look_pieces x join look_wears w on w.look_id = x.look_id where x.piece_id = lp.piece_id) as last_worn
    from look_pieces lp
    join looks l on l.id = lp.look_id
    where true ${only}
    group by lp.piece_id
  `
  return new Map(rows.map(({ piece_id, ...wear }) => [piece_id, wear]))
}

/** One piece's wear, for its page. */
export async function wearOf(pieceId: number, sql: Sql = db()): Promise<PieceWear> {
  return (await pieceWear(sql, [pieceId])).get(pieceId) ?? NONE
}

/** The Worn page: his saved looks, his pieces, what no look has worn, and the looks only offered. */
export async function readWear(sql: Sql = db(), now: Date = new Date()): Promise<WearPage> {
  const [summary] = await sql<{ since: string | null; days_worn: number }[]>`
    select (select to_char(min(offered_on), 'YYYY-MM-DD') from look_offers) as since,
           (select count(distinct worn_on)::int from look_wears) as days_worn
  `
  const ids = await sql<{ id: number }[]>`
    select l.id::int as id from looks l
    where l.status = 'saved' or (l.status = 'new' and exists (select 1 from look_offers o where o.look_id = l.id))
  `
  const [looks, pieces, wear] = await Promise.all([getLooks(ids.map((row) => row.id), sql), listPieces(sql), pieceWear(sql)])
  const ranked = looks.toSorted((a, b) => byPassedOver(lookRank(a), lookRank(b)))
  const active = pieces.filter((piece) => !piece.set_aside_at)
  const since = summary?.since ?? null
  const all = active
    .map((piece) => ({ ...piece, wear: wear.get(piece.id) ?? NONE }))
    .toSorted((a, b) => {
      const used = (x: WornPiece) => (x.wear.offered + x.wear.worn > 0 ? 0 : 1)
      return used(a) - used(b) || (used(a) === 0 ? byPassedOver({ ...a.wear, id: a.id }, { ...b.wear, id: b.id }) : a.created_at.getTime() - b.created_at.getTime() || a.id - b.id)
    })
  const rotate = all.filter((piece) => rotateOut(piece.wear, piece.created_at, since, now))
  const out = new Set(rotate.map((piece) => piece.id))
  const rest = all.filter((piece) => !out.has(piece.id))
  return {
    since,
    days_worn: summary?.days_worn ?? 0,
    rotate,
    saved: ranked.filter((look) => look.status === 'saved'),
    pieces: rest.filter((piece) => piece.wear.offered + piece.wear.worn > 0),
    never: rest.filter((piece) => piece.wear.offered + piece.wear.worn === 0),
    offered: ranked.filter((look) => look.status === 'new'),
  }
}
