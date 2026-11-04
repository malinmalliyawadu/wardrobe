/*
 * What happened to a saved find since he saved it, replayed from
 * price_observations: one row per variant per change of price or stock, so a
 * stable price costs nothing and every change is there.
 *
 * Only the variants in his size count when his size for the garment is
 * known: a drop on a size he cannot wear is not news, and "back in stock"
 * means back in his size. When it is not known, every variant counts, and the
 * copy says "in stock" rather than "your size".
 *
 * Pure, so the rules are tested without a database.
 */

export type Observation = {
  variant_id: number
  size_key: string | null
  observed_at: Date
  /** In the store's currency. */
  price_cents: number
  available: boolean
}

export type SavedEvent =
  | { kind: 'cheaper'; at: Date; from: number; to: number }
  | { kind: 'dearer'; at: Date; from: number; to: number }
  | { kind: 'sold_out'; at: Date }
  | { kind: 'back'; at: Date; price: number }

/** The lowest price in stock (in the counted sizes), or null when none is. */
type Moment = { at: Date; price: number | null }

export type SavedHistory = {
  /** Newest first. Only what happened after he saved it. */
  events: SavedEvent[]
  /** The lowest price seen in stock since he saved it, store currency. */
  lowest: number | null
}

/**
 * Replays observations (any order) into the moments where the counted sizes'
 * lowest in-stock price changed, then reads events off consecutive moments.
 * Observations sharing a timestamp are one moment: an ingest writes a
 * product's variants in one transaction.
 */
export function savedHistory(
  observations: Observation[],
  { savedAt, sizeKeys }: { savedAt: Date; sizeKeys: string[] | null },
): SavedHistory {
  const counted = sizeKeys
    ? observations.filter((row) => row.size_key !== null && sizeKeys.includes(row.size_key))
    : observations
  const sorted = [...counted].sort((a, b) => a.observed_at.getTime() - b.observed_at.getTime() || a.variant_id - b.variant_id)

  const state = new Map<number, { price: number; available: boolean }>()
  const moments: Moment[] = []
  for (let i = 0; i < sorted.length; ) {
    const at = sorted[i]!.observed_at
    while (i < sorted.length && sorted[i]!.observed_at.getTime() === at.getTime()) {
      const row = sorted[i]!
      state.set(row.variant_id, { price: row.price_cents, available: row.available })
      i += 1
    }
    const inStock = [...state.values()].filter((variant) => variant.available).map((variant) => variant.price)
    const price = inStock.length > 0 ? Math.min(...inStock) : null
    if (moments.length === 0 || moments.at(-1)!.price !== price) moments.push({ at, price })
  }

  // The moment in force when he saved it, and every one since.
  const firstAfter = moments.findIndex((moment) => moment.at.getTime() > savedAt.getTime())
  const since = firstAfter === -1 ? moments.slice(-1) : moments.slice(Math.max(0, firstAfter - 1))
  const prices = since.map((moment) => moment.price).filter((price): price is number => price !== null)
  const lowest = prices.length > 0 ? Math.min(...prices) : null

  const events: SavedEvent[] = []
  for (let i = 1; i < moments.length; i += 1) {
    const moment = moments[i]!
    const before = moments[i - 1]!
    if (moment.at.getTime() <= savedAt.getTime()) continue
    if (before.price !== null && moment.price === null) events.push({ kind: 'sold_out', at: moment.at })
    else if (before.price === null && moment.price !== null) events.push({ kind: 'back', at: moment.at, price: moment.price })
    else if (before.price !== null && moment.price !== null && moment.price < before.price) {
      events.push({ kind: 'cheaper', at: moment.at, from: before.price, to: moment.price })
    } else if (before.price !== null && moment.price !== null) {
      events.push({ kind: 'dearer', at: moment.at, from: before.price, to: moment.price })
    }
  }
  return { events: events.reverse(), lowest }
}

/**
 * The news worth a line on Today: the newest change, when it came at or after
 * `since` (the latest run's start) and is good news. Only the newest, so a
 * drop the shop has since undone is not reported.
 */
export function newsSince(events: SavedEvent[], since: Date | null): SavedEvent | null {
  const newest = events[0]
  if (!since || !newest || newest.at.getTime() < since.getTime() || newest.kind === 'dearer') return null
  return newest
}
