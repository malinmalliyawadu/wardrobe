import { db, type Sql } from './db.ts'
import { findPrice, latestRun, runRates, shownOnToday, type DismissReason, type Price } from './feed.ts'
import { wantedSizeKeys } from './finder/classify.ts'
import { OPEN_STATUSES } from './finder/filter.ts'
import type { ProductImage } from './finder/shopify.ts'
import type { Sizes } from './profile.ts'
import { tryOnAt, WALKED_PLATFORMS, type WellingtonStore } from './retailers.ts'
import { SHOPS_PAGE_SIZE, type ShopQuery } from './shop-query.ts'
import { GARMENT_TYPES, type GarmentType } from './wardrobe-values.ts'

/*
 * Everything the finder read, for the Shops page: every menswear product
 * still in stock at a store he has on, searchable, with what the finder made
 * of it. The feed on Today shows only what clears the bar for a slot; this is
 * where he finds what it passed over (too low a match, never shortlisted,
 * waiting to be judged) and saves it himself, for a slot or for none.
 *
 * "Closest first" puts what Claude matched to an open slot at the top, best
 * first; then what the rules shortlisted and Claude has yet to judge; then
 * what it matched to a slot already filled, or to none; then the rest, newest
 * first.
 */

/** What the finder made of a product, and what he did with it. */
export type ShopPiece = {
  product_id: number
  title: string
  vendor: string | null
  url: string
  image: ProductImage | null
  retailer: string
  try_on: string | null
  garment_type: GarmentType | null
  price: Price
  /** In stock, in his size when the page is narrowed to it, in the store's order. */
  sizes: string[]
  /** True when the sizes are his, known for this garment and narrowed to. */
  size_known: boolean
  /** Every store Shops lists is walked nightly, with stock per size. */
  stock_known: true
  /** Claude's latest judgement, of this or an earlier version of the listing. */
  judged: { score: number; slot_id: number | null; why: string | null } | null
  /** On the latest run's shortlist: the rules let it through for one of his slots. */
  shortlisted: boolean
  /** Showing on Today right now: it clears the bar and is among its slot's best. */
  on_today: boolean
  /** His latest action on it; a cleared save or dismissal counts as none. */
  action: { kind: 'saved' | 'dismissed' | 'bought'; slot_id: number | null; reason: DismissReason | null } | null
}

export type ShopPage = {
  pieces: ShopPiece[]
  total: number
  page: number
  pages: number
  /** False until the finder has read the shops once. */
  read: boolean
}

type Row = {
  product_id: number
  title: string
  vendor: string | null
  url: string
  image: ProductImage | null
  retailer: string
  currency: string
  country: string
  ships_to_nz: boolean
  wellington_store: WellingtonStore | null
  garment_type: GarmentType | null
  price_cents: number
  compare_at_cents: number | null
  sizes: string[] | null
  size_known: boolean
  score: number | null
  score_slot_id: number | null
  why: string | null
  shortlisted: boolean
  action: 'saved' | 'dismissed' | 'bought' | 'cleared' | null
  action_slot_id: number | null
  reason: DismissReason | null
  total: number
}

/** "navy  overshirt" is two words, each matched anywhere, with % and _ taken literally. */
export function searchPatterns(q: string): string[] {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((word) => `%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
}

/** His size keys for each garment the profile knows a size for. */
export function sizeKeysByGarment(sizes: Partial<Sizes>): Partial<Record<GarmentType, string[]>> {
  const keys: Partial<Record<GarmentType, string[]>> = {}
  for (const garment of GARMENT_TYPES) {
    const wanted = wantedSizeKeys(garment, [], sizes)
    if (wanted) keys[garment] = wanted
  }
  return keys
}

export async function searchShops(query: ShopQuery, sql: Sql = db()): Promise<ShopPage> {
  const run = await latestRun(sql)
  const today = run ? await shownOnToday(sql, run.id) : new Set<number>()
  const rates = runRates(run)
  const [profile] = await sql<{ sizes: Partial<Sizes> }[]>`select sizes from profile where id = 1`
  const keys = query.size === 'mine' ? sizeKeysByGarment(profile?.sizes ?? {}) : {}
  const patterns = searchPatterns(query.q)
  const offset = (query.page - 1) * SHOPS_PAGE_SIZE

  const order = {
    closest: sql`l.tier, l.score desc nulls last, l.first_seen_at desc, l.product_id desc`,
    newest: sql`l.first_seen_at desc, l.product_id desc`,
    price: sql`l.nzd_cents, l.product_id desc`,
  }[query.sort]

  const rows = await sql<Row[]>`
    with wanted as (
      select key as garment_type, array(select jsonb_array_elements_text(value)) as keys
      from jsonb_each(${sql.json(keys)})
    ),
    rates as (
      select key as currency, value::numeric as rate from jsonb_each_text(${sql.json(rates)})
    ),
    latest_action as (
      select distinct on (product_id) product_id, slot_id, action, reason
      from feed_actions order by product_id, created_at desc, id desc
    ),
    latest_score as (
      select distinct on (product_id) product_id, slot_id, score, why
      from product_scores order by product_id, scored_at desc, id desc
    ),
    listed as (
      select p.id::int as product_id, p.title, p.vendor, p.url, p.main_image as image, p.garment_type,
             p.first_seen_at,
             r.name as retailer, r.currency, r.country, r.ships_to_nz, r.wellington_store,
             w.keys is not null as size_known,
             v.price_cents, v.compare_at_cents, v.sizes,
             round(v.price_cents * coalesce(x.rate, 1)) as nzd_cents,
             s.score, s.slot_id::int as score_slot_id, s.why,
             c.product_id is not null as shortlisted,
             case
               when b.status in ${sql(OPEN_STATUSES)} then 1
               when c.product_id is not null and s.score is null then 2
               when s.score is not null then 3
               else 4
             end as tier
      from products p
      join retailers r on r.id = p.retailer_id and r.enabled and r.platform = any (${[...WALKED_PLATFORMS]}::text[])
      left join rates x on x.currency = r.currency
      left join wanted w on w.garment_type = p.garment_type
      cross join lateral (
        select min(pv.price_cents)::int as price_cents,
               (array_agg(pv.compare_at_cents order by pv.price_cents))[1]::int as compare_at_cents,
               array_agg(pv.option_size order by pv.id) filter (where pv.option_size is not null) as sizes,
               -- Many shops name the colour only on the variant.
               string_agg(distinct pv.option_colour, ' ') as colours
        from product_variants pv
        where pv.product_id = p.id and pv.available and pv.price_cents > 0
          and (w.keys is null or pv.size_key = any (w.keys))
        having count(*) > 0
      ) v
      left join latest_score s on s.product_id = p.id
      left join blueprint_slots b on b.id = s.slot_id
      left join finder_candidates c on c.run_id = ${run?.id ?? null} and c.product_id = p.id
      where p.removed_at is null
        and p.menswear
        and (${query.kind}::text is null or p.garment_type = ${query.kind})
        and (${query.shop}::text is null or r.slug = ${query.shop})
        and (
          cardinality(${patterns}::text[]) = 0
          or concat_ws(' ', p.title, p.vendor, p.product_type, array_to_string(p.tags, ' '), v.colours)
             ilike all (${patterns}::text[])
        )
    )
    select l.product_id, l.title, l.vendor, l.url, l.image, l.garment_type, l.retailer, l.currency, l.country, l.ships_to_nz,
           l.wellington_store,
           l.size_known, l.price_cents, l.compare_at_cents, l.sizes,
           l.score, l.score_slot_id, l.why, l.shortlisted,
           a.action, a.slot_id::int as action_slot_id, a.reason,
           (count(*) over ())::int as total
    from listed l
    left join latest_action a on a.product_id = l.product_id
    order by ${order}
    limit ${SHOPS_PAGE_SIZE} offset ${offset}
  `

  const total = rows[0]?.total ?? (offset > 0 ? await countOnly(sql, query) : 0)
  return {
    pieces: rows.map((row) => piece(row, rates, today)),
    total,
    page: query.page,
    pages: Math.max(1, Math.ceil(total / SHOPS_PAGE_SIZE)),
    read: run !== null,
  }
}

/** A page past the end has no rows to carry the count, so the pager is told how far back to go. */
async function countOnly(sql: Sql, query: ShopQuery): Promise<number> {
  const rows = await searchShops({ ...query, page: 1 }, sql)
  return rows.total
}

function piece(row: Row, rates: Record<string, number>, today: Set<number>): ShopPiece {
  const action = row.action && row.action !== 'cleared' ? row.action : null
  return {
    product_id: row.product_id,
    title: row.title,
    vendor: row.vendor,
    url: row.url,
    image: row.image,
    retailer: row.retailer,
    try_on: tryOnAt(row.wellington_store),
    garment_type: row.garment_type,
    price: findPrice(row, rates),
    // One row per colour repeats each size; keep the store's order.
    sizes: [...new Set(row.sizes ?? [])],
    size_known: row.size_known,
    stock_known: true,
    judged: row.score === null ? null : { score: row.score, slot_id: row.score_slot_id, why: row.why },
    shortlisted: row.shortlisted,
    on_today: today.has(row.product_id),
    action: action ? { kind: action, slot_id: row.action_slot_id, reason: row.reason } : null,
  }
}

/**
 * The slot a save goes to unless he picks another: the one Claude matched it
 * to, when that slot is still open, otherwise the first open slot for the same
 * garment, otherwise none.
 */
export function defaultSlot(
  piece: Pick<ShopPiece, 'judged' | 'garment_type'>,
  openSlots: { id: number; garment_type: GarmentType }[],
): number | null {
  const judged = piece.judged?.slot_id ?? null
  if (judged !== null && openSlots.some((slot) => slot.id === judged)) return judged
  return openSlots.find((slot) => slot.garment_type === piece.garment_type)?.id ?? null
}
