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
 * held by code (tidyDay), like the warmth limit. Pure, so it runs anywhere.
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

/**
 * Best option first, drops one that wears trousers or a top a better option
 * already wore, for as long as the day has others of that kind not yet used.
 */
export function spreadOut<T extends { piece_ids: number[] }>(
  options: T[],
  pieces: Rotated[],
  limit: WarmthLimit | null,
  resting: ReadonlySet<number>,
): T[] {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  const open = openPieces(pieces, limit).filter((piece) => !resting.has(piece.id))
  const kinds = ROTATED.map((types) => ({
    types,
    open: open.filter((piece) => types.includes(piece.garment_type)).length,
    used: new Set<number>(),
  }))
  return options.filter((option) => {
    const worn = kinds.map((kind) => option.piece_ids.filter((id) => kind.types.includes(byId.get(id)!.garment_type)))
    const tooSoon = kinds.some((kind, index) => kind.used.size < kind.open && worn[index]!.some((id) => kind.used.has(id)))
    if (tooSoon) return false
    kinds.forEach((kind, index) => worn[index]!.forEach((id) => kind.used.add(id)))
    return true
  })
}
