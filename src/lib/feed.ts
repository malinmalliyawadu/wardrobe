import type { TransactionSql } from 'postgres'
import { z } from 'zod'

import { listSlots, type Slot } from './blueprint.ts'
import { db, type Sql } from './db.ts'
import { wantedSizeKeys } from './finder/classify.ts'
import { OPEN_STATUSES, type Rates } from './finder/filter.ts'
import { FALLBACK_RATES } from './finder/fx.ts'
import { pieceFromPurchase, syncSlotPieces } from './pieces.ts'
import { photoChoices } from './product-photos.ts'
import { SHOW_THRESHOLD } from './finder/score.ts'
import type { ProductImage } from './finder/shopify.ts'
import type { Sizes } from './profile.ts'
import { STOCK_PLATFORMS, tryOnAt, type WellingtonStore } from './retailers.ts'
import { newsSince, savedHistory, type Observation, type SavedEvent } from './saved-history.ts'
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
  /** Where the store sells from, and whether it sends to New Zealand, for the line under a foreign price. */
  country: string
  shipsToNz: boolean
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
  /** False for a store whose page gives no stock (Uniqlo): the sizes are what it makes, not what it has. */
  stock_known: boolean
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
  /** True when his size for it is known, so "back in stock" means back in his size. */
  sizeTracked: boolean
  /** What changed since he saved it, newest first, in NZD at today's rate. */
  events: SavedEvent[]
  /** The newest change, when the latest run found it and it is good news. */
  news: SavedEvent | null
  /** Typed in by him from a store that cannot be read, so its price is never checked. */
  byHand: boolean
  /** The photos it can show: the shop's, and his own when he chose one (src/lib/product-photos.ts). */
  photos: ProductImage[]
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
  openSlots: { id: number; name: string; garment_type: GarmentType }[]
}

export type FindRow = Omit<FindCard, 'price' | 'try_on' | 'image' | 'on_me'> & {
  image: ProductImage | null
  currency: string
  ships_to_nz: boolean
  wellington_store: WellingtonStore | null
  price_cents: number
  compare_at_cents: number | null
}

type Row = FindRow

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

export function findPrice(
  row: Pick<Row, 'price_cents' | 'compare_at_cents' | 'currency' | 'country' | 'ships_to_nz'>,
  rates: Rates,
): Price {
  return {
    cents: row.price_cents,
    compareAtCents: row.compare_at_cents,
    currency: row.currency,
    nzdCents: toNzd(row.price_cents, row.currency, rates),
    compareAtNzdCents: row.compare_at_cents === null ? null : toNzd(row.compare_at_cents, row.currency, rates),
    country: row.country,
    shipsToNz: row.ships_to_nz,
  }
}

/** A find card from its row, priced in NZD at the given rates. Search results use it too. */
export function findCard(row: Row, rates: Rates): FindCard {
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
    price: findPrice(row, rates),
    sizes: row.sizes,
    size_known: row.size_known,
    stock_known: row.stock_known,
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

/**
 * The run's recorded rates. A currency it did not record (a link from a store
 * switched off, or from Uniqlo, before the next run reads its rate) takes the
 * conservative constant, never one to one.
 */
export function runRates(run: Run | null): Rates {
  const fx = run?.stats.fx as { rates?: Rates } | undefined
  return { ...FALLBACK_RATES, ...(fx?.rates ?? {}), NZD: 1 }
}

/**
 * The products Today shows from a run, for Shops to mark: the same rule as
 * getFeed (it clears the bar for an open slot it was shortlisted for, nothing
 * done with it yet, its shop still on), and the same best CARDS_PER_SLOT per
 * slot in the same order. A test holds the two to each other.
 */
export async function shownOnToday(sql: Sql, runId: number): Promise<Set<number>> {
  const rows = await sql<{ product_id: number }[]>`
    with latest_action as (
      select distinct on (product_id) product_id, action
      from feed_actions order by product_id, created_at desc, id desc
    ),
    ranked as (
      select c.product_id,
             row_number() over (partition by s.slot_id order by s.score desc, c.price_cents, c.product_id) as place
      from finder_candidates c
      join product_scores s on s.product_id = c.product_id and s.content_hash = c.content_hash
      join products p on p.id = c.product_id and p.removed_at is null
      join retailers r on r.id = p.retailer_id and r.enabled
      join blueprint_slots b on b.id = s.slot_id and b.status in ${sql(OPEN_STATUSES)}
      left join latest_action a on a.product_id = c.product_id
      where c.run_id = ${runId}
        and s.score >= ${SHOW_THRESHOLD}
        and s.slot_id = any (c.slot_ids)
        and coalesce(a.action, 'cleared') = 'cleared'
    )
    select product_id::int as product_id from ranked where place <= ${CARDS_PER_SLOT}
  `
  return new Set(rows.map((row) => row.product_id))
}

/** The wishlist: what he saved, with its news, and the open slots a new link can be saved for. */
export type Wishlist = Pick<Feed, 'run' | 'saved' | 'slotNames' | 'openSlots'>

export async function getWishlist(): Promise<Wishlist> {
  const sql = db()
  const [run, slots] = await Promise.all([latestRun(sql), listSlots()])
  const saved = await getSaved(sql, run, runRates(run))
  await attachTryOns(sql, saved)
  return {
    run,
    saved,
    slotNames: Object.fromEntries(slots.map((slot) => [slot.id, slot.name])),
    openSlots: slots
      .filter((slot) => (OPEN_STATUSES as readonly string[]).includes(slot.status))
      .map((slot) => ({ id: slot.id, name: slot.name, garment_type: slot.garment_type })),
  }
}

export async function getFeed(): Promise<Feed> {
  const sql = db()
  const [run, slots] = await Promise.all([latestRun(sql), listSlots()])
  const slotNames = Object.fromEntries(slots.map((slot) => [slot.id, slot.name]))
  const openSlots = slots
    .filter((slot) => (OPEN_STATUSES as readonly string[]).includes(slot.status))
    .map((slot) => ({ id: slot.id, name: slot.name, garment_type: slot.garment_type }))
  if (!run) {
    const saved = await getSaved(sql, null, runRates(null))
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
           p.title, p.vendor, p.url, p.main_image as image,
           r.name as retailer, r.country, r.currency, r.ships_to_nz, r.wellington_store,
           r.platform = any (${[...STOCK_PLATFORMS]}::text[]) as stock_known,
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
    if (list.length < CARDS_PER_SLOT) list.push(findCard(row, rates))
    bySlot.set(row.slot_id, list)
  }
  const saved = await getSaved(sql, run, rates)
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
async function getSaved(sql: Sql, run: Run | null, rates: Rates): Promise<SavedFind[]> {
  const runId = run?.id ?? null
  const [profile] = await sql<{ sizes: Partial<Sizes> }[]>`select sizes from profile where id = 1`
  const rows = await sql<
    (Row & {
      saved_at: Date
      saved_price_cents: number | null
      in_stock: boolean
      colour: string | null
      garment_type: GarmentType | null
      slot_garment: GarmentType | null
      slot_labels: string[] | null
      listed: { label: string; key: string | null }[] | null
      by_hand: boolean
      shop_images: ProductImage[]
    })[]
  >`
    with latest_action as (
      select distinct on (product_id) product_id, slot_id, action, price_cents, created_at
      from feed_actions order by product_id, created_at desc, id desc
    )
    select a.product_id::int as product_id, a.slot_id::int as slot_id, a.created_at as saved_at,
           a.price_cents as saved_price_cents,
           coalesce(s.score, 0) as score, s.why, s.colour_verdict, s.fit_verdict, s.fabric_notes, s.colour_option,
           p.title, p.vendor, p.url, p.main_image as image, p.images as shop_images,
           r.name as retailer, r.country, r.currency, r.ships_to_nz, r.wellington_store,
           r.platform = any (${[...STOCK_PLATFORMS]}::text[]) as stock_known, r.platform = 'manual' as by_hand,
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
           p.garment_type, bs.garment_type as slot_garment, bs.sizes -> 'labels' as slot_labels,
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
    left join blueprint_slots bs on bs.id = a.slot_id
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
  const observations = await savedObservations(sql, rows.map((row) => row.product_id))
  const nzdEvent = (event: SavedEvent, currency: string): SavedEvent => {
    const nzd = (cents: number) => toNzd(cents, currency, rates)
    if (event.kind === 'cheaper' || event.kind === 'dearer') return { ...event, from: nzd(event.from), to: nzd(event.to) }
    if (event.kind === 'back') return { ...event, price: nzd(event.price) }
    return event
  }
  return rows.map(({ saved_at, saved_price_cents, in_stock, colour, garment_type, slot_garment, slot_labels, listed, by_hand, shop_images, ...row }) => {
    // The slot's own size labels and garment when it was saved for one, as the filter reads them.
    const garment = slot_garment ?? garment_type
    const sizeKeys = garment ? wantedSizeKeys(garment, slot_labels ?? [], sizes) : null
    const history = savedHistory(observations.get(row.product_id) ?? [], { savedAt: saved_at, sizeKeys })
    const events = history.events.map((event) => nzdEvent(event, row.currency))
    return {
      ...findCard(withYourSize(row, garment_type, listed ?? [], sizes), rates),
      colour: colour ? titleCase(colour) : null,
      yourSizeOut: yourSizeOut(row.size_known, garment_type, listed ?? [], sizes),
      saved_at,
      savedNzdCents: saved_price_cents === null ? null : toNzd(saved_price_cents, row.currency, rates),
      inStock: in_stock,
      sizeTracked: sizeKeys !== null,
      events,
      // The stores are read before scoring, so a run still scoring has already found the changes.
      news: newsSince(events, run?.started_at ?? null),
      byHand: by_hand,
      photos: photoChoices(shop_images, row.image),
    }
  })
}

/** Every recorded price and stock change of these products' variants, by product. */
async function savedObservations(sql: Sql, productIds: number[]): Promise<Map<number, Observation[]>> {
  const byProduct = new Map<number, Observation[]>()
  if (productIds.length === 0) return byProduct
  const rows = await sql<(Observation & { product_id: number })[]>`
    select v.product_id::int as product_id, o.variant_id::int as variant_id, v.size_key,
           o.observed_at, o.price_cents, o.available
    from price_observations o join product_variants v on v.id = o.variant_id
    where v.product_id = any (${productIds}::bigint[])
  `
  for (const { product_id, ...observation } of rows) {
    const list = byProduct.get(product_id) ?? []
    list.push(observation)
    byProduct.set(product_id, list)
  }
  return byProduct
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
    // Not on the shortlist: a search result or a statement piece is saved at
    // the price and size found in his size; a pasted link at the lowest price
    // in stock.
    const [searched] = candidate
      ? []
      : await tx<{ price_cents: number; sizes: string[] }[]>`
          (select r.price_cents, r.sizes, s.started_at from search_results r join searches s on s.id = r.search_id
            where r.product_id = ${action.product_id} and r.in_stock)
          union all
          (select c.price_cents, c.sizes, f.started_at from statement_candidates c join finder_runs f on f.id = c.run_id
            where c.product_id = ${action.product_id})
          order by started_at desc limit 1
        `
    const [variant] = candidate || searched
      ? []
      : await tx<{ price_cents: number | null; size: string | null }[]>`
          -- A product with one size in stock (a find added by hand, a one-size piece) is saved in that size.
          select min(price_cents)::int as price_cents,
                 case when count(distinct option_size) = 1 then min(option_size) end as size
          from product_variants
          where product_id = ${action.product_id} and available
        `

    await tx`
      insert into feed_actions ${tx({
        product_id: action.product_id,
        slot_id: action.slot_id,
        action: action.action,
        reason: action.action === 'dismissed' ? action.reason : null,
        price_cents: candidate?.price_cents ?? searched?.price_cents ?? variant?.price_cents ?? null,
        size: candidate?.sizes[0] ?? searched?.sizes[0] ?? variant?.size ?? null,
      })}
    `

    if (action.action === 'bought') {
      // The product he bought is a piece in the wardrobe now, with or without a slot.
      await pieceFromPurchase(tx, {
        product_id: action.product_id,
        slot_id: action.slot_id,
        size: candidate?.sizes[0] ?? searched?.sizes[0] ?? variant?.size ?? null,
      })
    }
    if (action.slot_id === null) return
    if (action.action === 'saved') {
      await tx`update blueprint_slots set status = 'candidate' where id = ${action.slot_id} and status = 'wanted'`
    } else if (action.action === 'bought') {
      await tx`update blueprint_slots set status = 'owned' where id = ${action.slot_id} and status in ('wanted', 'candidate')`
      await syncSlotPieces(tx)
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
