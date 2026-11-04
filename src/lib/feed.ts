import type { TransactionSql } from 'postgres'
import { z } from 'zod'

import { listSlots, type Slot } from './blueprint.ts'
import { db, type Sql } from './db.ts'
import { wantedSizeKeys } from './finder/classify.ts'
import { OPEN_STATUSES, type Rates } from './finder/filter.ts'
import { SHOW_THRESHOLD } from './finder/score.ts'
import type { ProductImage } from './finder/shopify.ts'
import type { Sizes } from './profile.ts'
import { tryOnAt, type WellingtonStore } from './retailers.ts'
import { latestTryOns, type OnMe } from './try-on.ts'
import type { GarmentType } from './wardrobe-values.ts'

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
  /** Null only for a saved link that is not for a slot. Feed finds always have one. */
  slot_id: number | null
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

/** A saved find: from the feed, or a link he pasted, which need not be for a slot. */
export type SavedFind = FindCard & {
  /** The colour as the store names it, so two colours of one product tell apart. */
  colour: string | null
  /** His size for this garment, when it is known and the store has sold out of it. */
  yourSizeOut: string | null
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
  /** Wanted and candidate slots in blueprint order, for the "for which slot" choice. */
  openSlots: { id: number; name: string }[]
}

type Row = Omit<FindCard, 'price' | 'try_on' | 'image' | 'on_me'> & {
  image: ProductImage | null
  currency: string
  wellington_store: WellingtonStore | null
  price_cents: number
  compare_at_cents: number | null
}

/**
 * A saved product that was not on the shortlist (a pasted link) is checked
 * against his size here, the way the filter would: when his size for the
 * garment is known and in stock, the card says "your S"; when it is known and
 * sold out, it says so rather than listing sizes he cannot wear.
 */
function withYourSize<T extends Pick<Row, 'size_known' | 'sizes'>>(
  row: T,
  garment: GarmentType | null,
  listed: { label: string; key: string | null }[],
  sizes: Partial<Sizes>,
): T {
  if (row.size_known || !garment) return row
  const wanted = wantedSizeKeys(garment, [], sizes)
  if (!wanted) return row
  const mine = listed.filter((size) => size.key !== null && wanted.includes(size.key)).map((size) => size.label)
  return mine.length > 0 ? { ...row, size_known: true, sizes: mine } : row
}

function yourSizeOut(
  onShortlist: boolean,
  garment: GarmentType | null,
  listed: { label: string; key: string | null }[],
  sizes: Partial<Sizes>,
): string | null {
  if (onShortlist || !garment) return null
  const wanted = wantedSizeKeys(garment, [], sizes)
  if (!wanted || listed.some((size) => size.key !== null && wanted.includes(size.key))) return null
  return wanted[0] ?? null
}

/** "FRENCH VANILLA" and "french vanilla" both read "French Vanilla". */
function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase())
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
  const openSlots = slots
    .filter((slot) => (OPEN_STATUSES as readonly string[]).includes(slot.status))
    .map((slot) => ({ id: slot.id, name: slot.name }))
  if (!run) {
    const saved = await getSaved(sql, null, { NZD: 1 })
    await attachTryOns(sql, saved)
    return { run: null, groups: [], saved, quietSlots: 0, total: 0, slotNames, openSlots }
  }
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
    if (row.slot_id === null) continue
    const list = bySlot.get(row.slot_id) ?? []
    if (list.length < CARDS_PER_SLOT) list.push(card(row, rates))
    bySlot.set(row.slot_id, list)
  }
  const saved = await getSaved(sql, run.id, rates)
  const shown = [...bySlot.values()].flat()
  await attachTryOns(sql, [...shown, ...saved])
  const open = slots.filter((slot) => (OPEN_STATUSES as readonly string[]).includes(slot.status))
  const groups = open.flatMap((slot) => {
    const cards = bySlot.get(slot.id)
    return cards ? [{ slot, cards }] : []
  })
  const openIds = new Set(open.map((slot) => slot.id))
  const total = rows.filter((row) => row.slot_id !== null && openIds.has(row.slot_id)).length

  return {
    run,
    groups,
    saved,
    quietSlots: open.length - groups.length,
    total,
    slotNames,
    openSlots,
  }
}

/** Each card's latest "See it on me" image, in one query. */
async function attachTryOns(sql: Sql, finds: FindCard[]): Promise<void> {
  const onMe = await latestTryOns([...new Set(finds.map((find) => find.product_id))], sql)
  for (const find of finds) find.on_me = onMe.get(find.product_id) ?? null
}

/**
 * What he saved, newest first. Price and sizes come from the latest run's
 * shortlist when the find was on it (so "your size" holds), otherwise from the
 * product's own variants: a link he pasted, or a find whose size sold out.
 */
async function getSaved(sql: Sql, runId: number | null, rates: Rates): Promise<SavedFind[]> {
  const [profile] = await sql<{ sizes: Partial<Sizes> }[]>`select sizes from profile where id = 1`
  const rows = await sql<
    (Row & {
      saved_at: Date
      saved_price_cents: number | null
      in_stock: boolean
      colour: string | null
      garment_type: GarmentType | null
      listed: { label: string; key: string | null }[] | null
    })[]
  >`
    with latest_action as (
      select distinct on (product_id) product_id, slot_id, action, price_cents, created_at
      from feed_actions order by product_id, created_at desc, id desc
    )
    select a.product_id::int as product_id, a.slot_id::int as slot_id, a.created_at as saved_at,
           a.price_cents as saved_price_cents,
           coalesce(s.score, 0) as score, s.why, s.colour_verdict, s.fit_verdict, s.fabric_notes, s.colour_option,
           p.title, p.vendor, p.url, p.images -> 0 as image,
           r.name as retailer, r.country, r.currency, r.wellington_store,
           coalesce(c.price_cents, v.price_cents, a.price_cents, 0) as price_cents,
           coalesce(c.compare_at_cents, v.compare_at_cents) as compare_at_cents,
           coalesce(c.sizes, v.sizes, '{}') as sizes, coalesce(c.size_known, false) as size_known,
           (p.removed_at is null and (c.product_id is not null or v.price_cents is not null)) as in_stock,
           coalesce(s.colour_option, (
             select string_agg(colour, ', ' order by first_id) from (
               select option_colour as colour, min(id) as first_id from product_variants
               where product_id = a.product_id and option_colour is not null
               group by option_colour
             ) listed
           )) as colour,
           p.garment_type,
           (
             -- Every size in stock with its key, in the store's order, to check his against.
             select json_agg(json_build_object('label', option_size, 'key', size_key) order by first_id) from (
               select option_size, size_key, min(id) as first_id from product_variants
               where product_id = a.product_id and available and option_size is not null
               group by option_size, size_key
             ) listed
           ) as listed
    from latest_action a
    join products p on p.id = a.product_id
    join retailers r on r.id = p.retailer_id
    left join finder_candidates c on c.run_id = ${runId} and c.product_id = a.product_id
    left join lateral (
      select min(pv.price_cents)::int as price_cents,
             (array_agg(pv.compare_at_cents order by pv.price_cents))[1]::int as compare_at_cents,
             (
               -- Each size once, in the order the store lists them.
               select array_agg(option_size order by first_id) from (
                 select option_size, min(id) as first_id from product_variants
                 where product_id = a.product_id and available and option_size is not null
                 group by option_size
               ) listed
             ) as sizes
      from product_variants pv where pv.product_id = a.product_id and pv.available
      having count(*) > 0
    ) v on true
    left join lateral (
      select * from product_scores ps where ps.product_id = a.product_id
      order by ps.scored_at desc limit 1
    ) s on true
    where a.action = 'saved'
    order by a.created_at desc
  `
  const sizes = profile?.sizes ?? {}
  return rows.map(({ saved_at, saved_price_cents, in_stock, colour, garment_type, listed, ...row }) => {
    return {
      ...card(withYourSize(row, garment_type, listed ?? [], sizes), rates),
      colour: colour ? titleCase(colour) : null,
      yourSizeOut: yourSizeOut(row.size_known, garment_type, listed ?? [], sizes),
    saved_at,
      savedNzdCents: saved_price_cents === null ? null : toNzd(saved_price_cents, row.currency, rates),
      inStock: in_stock,
    }
  })
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ActionSchema = z.discriminatedUnion('action', [
  // A saved link need not be for a slot, so saving, clearing and buying take one or none.
  z.object({ action: z.literal('saved'), product_id: z.number().int().positive(), slot_id: z.number().int().positive().nullable() }),
  z.object({ action: z.literal('cleared'), product_id: z.number().int().positive(), slot_id: z.number().int().positive().nullable() }),
  z.object({ action: z.literal('bought'), product_id: z.number().int().positive(), slot_id: z.number().int().positive().nullable() }),
  z.object({
    action: z.literal('dismissed'),
    product_id: z.number().int().positive(),
    slot_id: z.number().int().positive().nullable(),
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
    // Not on the shortlist (a pasted link): the lowest price in stock is what it was saved at.
    const [variant] = candidate
      ? []
      : await tx<{ price_cents: number | null }[]>`
          select min(price_cents)::int as price_cents from product_variants
          where product_id = ${action.product_id} and available
        `

    await tx`
      insert into feed_actions ${tx({
        product_id: action.product_id,
        slot_id: action.slot_id,
        action: action.action,
        reason: action.action === 'dismissed' ? action.reason : null,
        price_cents: candidate?.price_cents ?? variant?.price_cents ?? null,
        size: candidate?.sizes[0] ?? null,
      })}
    `

    if (action.slot_id === null) return
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
