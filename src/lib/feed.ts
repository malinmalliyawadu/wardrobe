import type { TransactionSql } from 'postgres'
import { z } from 'zod'

import { listSlots, type Slot } from './blueprint.ts'
import { db, type Sql } from './db.ts'
import { OPEN_STATUSES, type Rates } from './finder/filter.ts'
import { SHOW_THRESHOLD } from './finder/score.ts'
import type { ProductImage } from './finder/shopify.ts'
import { tryOnAt, type WellingtonStore } from './retailers.ts'
import { latestTryOns, type OnMe } from './try-on.ts'

/*
 * The feed on Today: the latest run's candidates whose current score clears
 * the threshold for a slot they were offered, grouped by slot in blueprint
 * order, best first. Saved finds are listed on their own, re-read against
 * every run for a lower price or a size that sold out.
 */

export const DISMISS_REASONS = ['colour', 'fit', 'price', 'not_for_me'] as const
export type DismissReason = (typeof DISMISS_REASONS)[number]

export const REASON_LABELS: Record<DismissReason, string> = {
  colour: 'Colour',
  fit: 'Fit',
  price: 'Price',
  not_for_me: 'Not my thing',
}

export const CARDS_PER_SLOT = 8

export type Price = {
  /** In the store's currency. */
  cents: number
  compareAtCents: number | null
  currency: string
  /** Converted at the run's rate; equal to cents for NZD. */
  nzdCents: number
  compareAtNzdCents: number | null
}

export type FindCard = {
  product_id: number
  slot_id: number
  score: number
  why: string | null
  colour_verdict: string | null
  fit_verdict: string | null
  fabric_notes: string | null
  colour_option: string | null
  title: string
  vendor: string | null
  url: string
  image: ProductImage | null
  retailer: string
  country: string
  try_on: string | null
  price: Price
  sizes: string[]
  size_known: boolean
  /** The latest "See it on me" image of this find, if he asked for one. */
  on_me: OnMe | null
}

export type FeedGroup = { slot: Slot; cards: FindCard[] }

export type SavedFind = FindCard & {
  saved_at: Date
  /** The price it was saved at, converted at today's rate. */
  savedNzdCents: number | null
  /** False when the latest run found it out of stock in his size, or gone from the store. */
  inStock: boolean
}

export type Run = {
  id: number
  status: 'running' | 'succeeded'
  started_at: Date
  /** Null while it is still scoring. */
  finished_at: Date | null
  stats: Record<string, unknown>
}

export type Feed = {
  run: Run | null
  groups: FeedGroup[]
  saved: SavedFind[]
  /** Open slots with no find that clears the bar, for the line under the feed. */
  quietSlots: number
  /** Every find that clears the bar; each slot shows its best CARDS_PER_SLOT. */
  total: number
  slotNames: Record<number, string>
}

type Row = Omit<FindCard, 'price' | 'try_on' | 'image' | 'on_me'> & {
  image: ProductImage | null
  currency: string
  wellington_store: WellingtonStore | null
  price_cents: number
  compare_at_cents: number | null
}

export function toNzd(cents: number, currency: string, rates: Rates): number {
  return Math.round(cents * (rates[currency] ?? 1))
}

function price(row: Pick<Row, 'price_cents' | 'compare_at_cents' | 'currency'>, rates: Rates): Price {
  return {
    cents: row.price_cents,
    compareAtCents: row.compare_at_cents,
    currency: row.currency,
    nzdCents: toNzd(row.price_cents, row.currency, rates),
    compareAtNzdCents: row.compare_at_cents === null ? null : toNzd(row.compare_at_cents, row.currency, rates),
  }
}

function card(row: Row, rates: Rates): FindCard {
  return {
    product_id: row.product_id,
    slot_id: row.slot_id,
    score: row.score,
    why: row.why,
    colour_verdict: row.colour_verdict,
    fit_verdict: row.fit_verdict,
    fabric_notes: row.fabric_notes,
    colour_option: row.colour_option,
    title: row.title,
    vendor: row.vendor,
    url: row.url,
    image: row.image,
    retailer: row.retailer,
    country: row.country,
    try_on: tryOnAt(row.wellington_store),
    price: price(row, rates),
    sizes: row.sizes,
    size_known: row.size_known,
    on_me: null,
  }
}

/**
 * The run the feed shows: the newest that has recorded its candidates, so
 * finds appear as they are scored rather than only once the run ends. A run
 * still marked running after three hours died without saying so, and is
 * passed over.
 */
export async function latestRun(sql: Sql | TransactionSql = db()): Promise<Run | null> {
  const [run] = await sql<Run[]>`
    select r.id::int as id, r.status, r.started_at, r.finished_at, r.stats from finder_runs r
    where (r.status = 'succeeded' or (r.status = 'running' and r.started_at > now() - interval '3 hours'))
      and exists (select 1 from finder_candidates c where c.run_id = r.id)
    order by r.started_at desc limit 1
  `
  return run ?? null
}

function runRates(run: Run | null): Rates {
  const fx = run?.stats.fx as { rates?: Rates } | undefined
  return { NZD: 1, ...(fx?.rates ?? {}) }
}

export async function getFeed(): Promise<Feed> {
  const sql = db()
  const [run, slots] = await Promise.all([latestRun(sql), listSlots()])
  const slotNames = Object.fromEntries(slots.map((slot) => [slot.id, slot.name]))
  if (!run) return { run: null, groups: [], saved: [], quietSlots: 0, total: 0, slotNames }
  const rates = runRates(run)

  const rows = await sql<Row[]>`
    with latest_action as (
      select distinct on (product_id) product_id, action
      from feed_actions order by product_id, created_at desc, id desc
    )
    select c.product_id::int as product_id, s.slot_id::int as slot_id, s.score, s.why,
           s.colour_verdict, s.fit_verdict, s.fabric_notes, s.colour_option,
           p.title, p.vendor, p.url, p.images -> 0 as image,
           r.name as retailer, r.country, r.currency, r.wellington_store,
           c.price_cents, c.compare_at_cents, c.sizes, c.size_known
    from finder_candidates c
    join product_scores s on s.product_id = c.product_id and s.content_hash = c.content_hash
    join products p on p.id = c.product_id and p.removed_at is null
    -- A store switched off since the run goes from the feed at once.
    join retailers r on r.id = p.retailer_id and r.enabled
    left join latest_action a on a.product_id = c.product_id
    where c.run_id = ${run.id}
      and s.score >= ${SHOW_THRESHOLD}
      and s.slot_id = any (c.slot_ids)
      and coalesce(a.action, 'cleared') = 'cleared'
    order by s.score desc, c.price_cents, c.product_id
  `

  const bySlot = new Map<number, FindCard[]>()
  for (const row of rows) {
    const list = bySlot.get(row.slot_id) ?? []
    if (list.length < CARDS_PER_SLOT) list.push(card(row, rates))
    bySlot.set(row.slot_id, list)
  }
  const shown = [...bySlot.values()].flat()
  const onMe = await latestTryOns(shown.map((find) => find.product_id), sql)
  for (const find of shown) find.on_me = onMe.get(find.product_id) ?? null
  const open = slots.filter((slot) => (OPEN_STATUSES as readonly string[]).includes(slot.status))
  const groups = open.flatMap((slot) => {
    const cards = bySlot.get(slot.id)
    return cards ? [{ slot, cards }] : []
  })
  const openIds = new Set(open.map((slot) => slot.id))
  const total = rows.filter((row) => openIds.has(row.slot_id)).length

  return { run, groups, saved: await getSaved(sql, run, rates), quietSlots: open.length - groups.length, total, slotNames }
}

async function getSaved(sql: Sql, run: Run, rates: Rates): Promise<SavedFind[]> {
  const rows = await sql<(Row & { saved_at: Date; saved_price_cents: number | null; in_stock: boolean })[]>`
    with latest_action as (
      select distinct on (product_id) product_id, slot_id, action, price_cents, created_at
      from feed_actions order by product_id, created_at desc, id desc
    )
    select a.product_id::int as product_id, a.slot_id::int as slot_id, a.created_at as saved_at,
           a.price_cents as saved_price_cents,
           coalesce(s.score, 0) as score, s.why, s.colour_verdict, s.fit_verdict, s.fabric_notes, s.colour_option,
           p.title, p.vendor, p.url, p.images -> 0 as image,
           r.name as retailer, r.country, r.currency, r.wellington_store,
           coalesce(c.price_cents, a.price_cents, 0) as price_cents,
           c.compare_at_cents,
           coalesce(c.sizes, '{}') as sizes, coalesce(c.size_known, true) as size_known,
           (c.product_id is not null and p.removed_at is null) as in_stock
    from latest_action a
    join products p on p.id = a.product_id
    join retailers r on r.id = p.retailer_id
    left join finder_candidates c on c.run_id = ${run.id} and c.product_id = a.product_id
    left join lateral (
      select * from product_scores ps where ps.product_id = a.product_id
      order by ps.scored_at desc limit 1
    ) s on true
    where a.action = 'saved'
    order by a.created_at desc
  `
  return rows.map(({ saved_at, saved_price_cents, in_stock, ...row }) => ({
    ...card(row, rates),
    saved_at,
    savedNzdCents: saved_price_cents === null ? null : toNzd(saved_price_cents, row.currency, rates),
    inStock: in_stock,
  }))
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saved'), product_id: z.number().int().positive(), slot_id: z.number().int().positive() }),
  z.object({ action: z.literal('cleared'), product_id: z.number().int().positive(), slot_id: z.number().int().positive() }),
  z.object({ action: z.literal('bought'), product_id: z.number().int().positive(), slot_id: z.number().int().positive() }),
  z.object({
    action: z.literal('dismissed'),
    product_id: z.number().int().positive(),
    slot_id: z.number().int().positive(),
    reason: z.enum(DISMISS_REASONS),
  }),
])

export type FeedAction = z.infer<typeof ActionSchema>

/**
 * One feed action, and what it does to the slot. Saving makes a wanted slot a
 * candidate; un-saving or dismissing the last saved find for a slot makes it
 * wanted again; buying fills it. All in one transaction.
 */
export async function recordAction(input: FeedAction, sql: Sql = db()): Promise<void> {
  const action = ActionSchema.parse(input)
  await sql.begin(async (tx) => {
    const run = await latestRun(tx)
    const [candidate] = run
      ? await tx<{ price_cents: number; sizes: string[] }[]>`
          select price_cents, sizes from finder_candidates where run_id = ${run.id} and product_id = ${action.product_id}
        `
      : []

    await tx`
      insert into feed_actions ${tx({
        product_id: action.product_id,
        slot_id: action.slot_id,
        action: action.action,
        reason: action.action === 'dismissed' ? action.reason : null,
        price_cents: candidate?.price_cents ?? null,
        size: candidate?.sizes[0] ?? null,
      })}
    `

    if (action.action === 'saved') {
      await tx`update blueprint_slots set status = 'candidate' where id = ${action.slot_id} and status = 'wanted'`
    } else if (action.action === 'bought') {
      await tx`update blueprint_slots set status = 'owned' where id = ${action.slot_id} and status in ('wanted', 'candidate')`
    } else {
      // Cleared or dismissed: the slot goes back to wanted once nothing saved is left for it.
      await tx`
        update blueprint_slots set status = 'wanted'
        where id = ${action.slot_id} and status = 'candidate'
          and not exists (
            select 1 from (
              select distinct on (product_id) product_id, slot_id, action
              from feed_actions order by product_id, created_at desc, id desc
            ) latest
            where latest.slot_id = ${action.slot_id} and latest.action = 'saved'
          )
      `
    }
  })
}
