import { BOTTOMS, TOPS } from './look-rules.ts'
import type { Piece } from './pieces.ts'
import { suitsDay, type WarmthLimit } from './warmth.ts'
import { forEveryday } from './wardrobe-values.ts'

/*
 * Keeps the outfit of the day moving through his trousers and tops. Each
 * day's call starts from nothing, so with the same wardrobe and much the same
 * weather Opus reaches for the same few pieces, and until he logs a wear it
 * cannot tell. So what was on Today in the past fortnight is read here, the
 * pieces shown most recently rest for the day, and the day's options are kept
 * from leaning on one pair of trousers or one top. Stated in the prompt and
 * held by code (tidyDay), like the warmth limit.
 *
 * Resting is all or nothing, so what is left is weighed (Malin's ask,
 * 2026-11-10). Opus gives more outfits than the day shows, best first, and
 * each starts from its place in that order. It loses weight for how lately
 * its pieces were on Today and for how close it is to an outfit that was, a
 * showing counting for half as much every HALF_LIFE_DAYS. The day's options
 * are then taken one at a time, heaviest first, each further candidate losing
 * weight for the pieces it shares with those already taken, so the three are
 * fresh and unlike each other. Pure, so it runs anywhere.
 */

/** How far back what he was shown counts. */
export const OFFERS_WINDOW_DAYS = 14

/** A kind of garment always leaves at least this many pieces to dress him in. */
const MIN_FRESH = 2

/** The kinds that rotate. Shoes and outer layers are few, so they may repeat. */
const ROTATED = [BOTTOMS, TOPS]

export type PieceOffers = {
  /** The latest day it was in one of Today's options or a look he wore, YYYY-MM-DD; null when only a set of looks had it. */
  last_on_today: string | null
  /** How many days and sets it was offered in, inside the window. */
  times: number
}

export type Rotated = Pick<Piece, 'id' | 'name' | 'garment_type' | 'fabric' | 'warmth' | 'set_aside_at' | 'worn_for'>

/** What he could wear on an everyday outfit that day. */
function openPieces<T extends Rotated>(pieces: T[], limit: WarmthLimit | null): T[] {
  return pieces.filter(
    (piece) => !piece.set_aside_at && forEveryday(piece) && piece.garment_type !== 'activewear' && suitsDay(piece, limit),
  )
}

/**
 * The trousers and tops to leave out of the day's outfits: of each kind the
 * ones on Today most recently, leaving at least half of those the day allows
 * (and never fewer than MIN_FRESH). A piece not yet shown never rests.
 */
export function restingPieces(pieces: Rotated[], offered: Map<number, PieceOffers>, limit: WarmthLimit | null): Set<number> {
  const open = openPieces(pieces, limit)
  const last = (piece: Rotated) => offered.get(piece.id)?.last_on_today ?? ''
  const resting = new Set<number>()
  for (const kind of ROTATED) {
    const ofKind = open.filter((piece) => kind.includes(piece.garment_type))
    const keep = Math.max(MIN_FRESH, Math.ceil(ofKind.length / 2))
    const leastSeenFirst = [...ofKind].sort(
      (a, b) =>
        last(a).localeCompare(last(b)) || (offered.get(a.id)?.times ?? 0) - (offered.get(b.id)?.times ?? 0) || a.id - b.id,
    )
    for (const piece of leastSeenFirst.slice(keep)) if (last(piece)) resting.add(piece.id)
  }
  return resting
}

/** An outfit that was on Today, or that he wore, inside the window. */
export type Shown = {
  /** Days before the day being dressed; 0 is the same day, when he asked again. */
  days_ago: number
  piece_ids: number[]
}

/** A showing counts for half as much after this many days. */
const HALF_LIFE_DAYS = 4

/**
 * What each thing costs an outfit, against a place in Opus's order worth 1
 * for the best and 0 past the last. An outfit on Today yesterday gives up
 * about a whole order's worth, so every fresh one is ahead of it; one from a
 * week ago gives up about two places of six. An option sharing a jacket and
 * shoes with one already taken gives up three.
 */
const WEIGHTS = {
  /** Its pieces were all on Today today. */
  pieces: 0.5,
  /** It is, piece for piece, an outfit on Today today. */
  outfit: 0.7,
  /** It is, piece for piece, an option already taken for the day. */
  alike: 1.5,
}

function recency(daysAgo: number): number {
  return 0.5 ** (Math.max(0, daysAgo) / HALF_LIFE_DAYS)
}

/** How alike two outfits are: the pieces they share over the pieces in either, 0 to 1. */
export function alike(a: number[], b: number[]): number {
  const other = new Set(b)
  const shared = new Set(a.filter((id) => other.has(id))).size
  const either = new Set([...a, ...b]).size
  return either === 0 ? 0 : shared / either
}

/** How lately each piece was shown, 0 to 1: each day it was on Today counts once, by how recent. */
function pieceHeat(shown: Shown[]): Map<number, number> {
  const days = new Map<number, Set<number>>()
  for (const outfit of shown) {
    for (const id of outfit.piece_ids) days.set(id, (days.get(id) ?? new Set()).add(outfit.days_ago))
  }
  return new Map([...days].map(([id, ago]) => [id, Math.min(1, [...ago].reduce((sum, day) => sum + recency(day), 0))]))
}

/**
 * The weight an outfit loses for what was shown lately: how lately its pieces
 * were on Today, on average, and how close it comes to one outfit that was.
 * From 0, nothing of it shown, to 1.2, the same outfit earlier the same day.
 */
export function staleness(pieceIds: number[], shown: Shown[], heat: Map<number, number> = pieceHeat(shown)): number {
  if (pieceIds.length === 0) return 0
  const pieces = pieceIds.reduce((sum, id) => sum + (heat.get(id) ?? 0), 0) / pieceIds.length
  const outfit = Math.max(0, ...shown.map((seen) => alike(pieceIds, seen.piece_ids) * recency(seen.days_ago)))
  return WEIGHTS.pieces * pieces + WEIGHTS.outfit * outfit
}

/**
 * The day's options from Opus's candidates, best first: up to `count`, taken
 * one at a time by weight. A candidate's weight is its place in Opus's order,
 * less its staleness, less how alike it is to the closest option already
 * taken. One in the trousers or a top of an option already taken is passed
 * over for as long as the day has others of that kind not yet used.
 */
export function chooseVaried<T extends { piece_ids: number[] }>(
  options: T[],
  pieces: Rotated[],
  limit: WarmthLimit | null,
  resting: ReadonlySet<number>,
  shown: Shown[],
  count: number,
): T[] {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  const open = openPieces(pieces, limit).filter((piece) => !resting.has(piece.id))
  const kinds = ROTATED.map((types) => ({
    types,
    open: open.filter((piece) => types.includes(piece.garment_type)).length,
    used: new Set<number>(),
  }))
  const ofKind = (option: T, types: string[]) => option.piece_ids.filter((id) => types.includes(byId.get(id)!.garment_type))
  const heat = pieceHeat(shown)
  const left = options.map((option, index) => ({
    option,
    weight: 1 - index / options.length - staleness(option.piece_ids, shown, heat),
  }))
  const taken: T[] = []
  while (taken.length < count) {
    let best: { at: number; weight: number } | null = null
    for (const [at, { option, weight }] of left.entries()) {
      const tooSoon = kinds.some((kind) => kind.used.size < kind.open && ofKind(option, kind.types).some((id) => kind.used.has(id)))
      if (tooSoon) continue
      const unlike = weight - WEIGHTS.alike * Math.max(0, ...taken.map((other) => alike(option.piece_ids, other.piece_ids)))
      if (!best || unlike > best.weight) best = { at, weight: unlike }
    }
    if (!best) break
    const [{ option }] = left.splice(best.at, 1) as [(typeof left)[number]]
    for (const kind of kinds) for (const id of ofKind(option, kind.types)) kind.used.add(id)
    taken.push(option)
  }
  return taken
}
