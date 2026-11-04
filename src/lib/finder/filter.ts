import type { Slot } from '../blueprint.ts'
import type { Sql } from '../db.ts'
import type { Sizes } from '../profile.ts'
import type { GarmentType } from '../wardrobe-values.ts'

import { slotKind, wantedSizeKeys } from './classify.ts'
import { colourCompatible, cutCompatible, namedCut, productFamilies, slotFamilies, type Family } from './colour.ts'
import { familiesOfColours } from './photo-colour.ts'

/*
 * Stage 2: rules and SQL only, no Claude. A product is a candidate for a slot
 * when it is menswear, still in the feed, the same garment (and, for
 * accessories, the same kind), in stock in his size, inside the slot's budget
 * band in NZD, not dismissed or bought, from a store he has on, and not
 * plainly the wrong colour (see colour.ts). Slots that are wanted or already
 * have a saved candidate are open; owned and retired slots are not.
 *
 * The band's lower edge is read against the full price as well: a $200 knit
 * marked down to $120 is still a $150-270 knit.
 */

export type SlotTarget = {
  slot_id: number
  garment_type: GarmentType
  kind: string | null
  min_cents: number | null
  max_cents: number | null
  /** Null when his size for this garment is not known; any size in stock passes. */
  sizes: string[] | null
  /** The colour families the slot accepts. Null when its colour words name none. */
  families: Family[] | null
  /** The cuts the slot and the guide allow for its garment. Null when neither says. */
  fits: string[] | null
}

export type Candidate = {
  product_id: number
  content_hash: string
  slot_ids: number[]
  sizes: string[]
  size_known: boolean
  price_cents: number
  compare_at_cents: number | null
}

/** Currency to NZD multipliers, NZD itself included. */
export type Rates = Record<string, number>

export const OPEN_STATUSES = ['wanted', 'candidate'] as const

export function slotTargets(
  slots: Slot[],
  sizes: Partial<Sizes>,
  colourName: (hex: string) => string | null = () => null,
  guideFits: (garment: GarmentType) => string[] = () => [],
): SlotTarget[] {
  return slots
    .filter((slot) => (OPEN_STATUSES as readonly string[]).includes(slot.status))
    .map((slot) => ({
      slot_id: slot.id,
      garment_type: slot.garment_type,
      kind: slotKind(slot.garment_type, slot.name),
      min_cents: slot.budget_min_cents,
      max_cents: slot.budget_max_cents,
      sizes: wantedSizeKeys(slot.garment_type, slot.sizes.labels ?? [], sizes),
      families: slotFamilies([
        slot.name,
        slot.colour_family ?? '',
        ...slot.colours.map((hex) => colourName(hex) ?? ''),
      ]),
      fits: allowedFits(slot.fit, guideFits(slot.garment_type)),
    }))
}

export function allowedFits(slotFit: string | null, guide: string[]): string[] | null {
  const fits = [...new Set([...(slotFit ? [slotFit] : []), ...guide])]
  return fits.length > 0 ? fits : null
}

export type Matched = Candidate & {
  title: string
  vendor: string | null
  tags: string[]
  colours: string[]
  image_src: string | null
  image_colour_src: string | null
  /** Hex colours read from the photo; see photo-colour.ts. */
  image_colours: string[] | null
}

/** Reads a photo's dominant colours as hex; the finder passes one backed by the polite client. */
export type PhotoReader = (src: string) => Promise<string[]>

export type FilterStats = { matched: number; candidates: number; photos_read: number; photos_failed: number }

export async function findCandidates(
  sql: Sql,
  targets: SlotTarget[],
  rates: Rates,
  options: {
    readPhoto?: PhotoReader | null
    /** Only these products; a search re-checking what it shows after a fresh read. */
    productIds?: number[] | null
  } = {},
): Promise<{ candidates: Candidate[]; stats: FilterStats }> {
  const stats: FilterStats = { matched: 0, candidates: 0, photos_read: 0, photos_failed: 0 }
  if (targets.length === 0) return { candidates: [], stats }
  const matched = await matchInSql(sql, targets, rates, options.productIds ?? null)
  const readPhoto = options.readPhoto ?? null
  stats.matched = matched.length
  if (readPhoto) await readMissingPhotos(sql, matched, readPhoto, stats)
  const candidates = applyProductRules(matched, targets)
  stats.candidates = candidates.length
  return { candidates, stats }
}

/** The photo URL without Shopify's ?v= cache-buster, which is what a read is keyed on. */
export function photoKey(src: string): string {
  return src.split('?')[0]!
}

/**
 * Reads the photo of every matched product whose listing names no colour and
 * whose current photo has not been read before, and keeps the result on the
 * product. Reads run a few at a time; the client paces them per host.
 */
async function readMissingPhotos(sql: Sql, matched: Matched[], readPhoto: PhotoReader, stats: FilterStats): Promise<void> {
  const todo = matched.filter(
    (row) =>
      row.image_src !== null &&
      productFamilies(row).length === 0 &&
      row.image_colour_src !== photoKey(row.image_src),
  )
  const queue = [...todo]
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const key = photoKey(row.image_src!)
      try {
        const colours = await readPhoto(row.image_src!)
        row.image_colours = colours
        row.image_colour_src = key
        stats.photos_read += 1
        await sql`
          update products set image_colour_src = ${key}, image_colours = ${colours}
          where id = ${row.product_id}
        `
      } catch {
        // An unreadable photo leaves the product to Claude, and is tried again next run.
        stats.photos_failed += 1
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
}

/**
 * Drops each slot a product is plainly wrong for, and the product once none
 * is left: the wrong colour (the listing's words decide when they name one,
 * the photo's read when they do not, and with neither the product stays), or
 * a cut the listing names that the slot and the guide do not allow.
 */
export function applyProductRules(
  matched: Matched[],
  targets: Pick<SlotTarget, 'slot_id' | 'families' | 'fits'>[],
): Candidate[] {
  const families = new Map(targets.map((target) => [target.slot_id, target.families]))
  const fits = new Map(targets.map((target) => [target.slot_id, target.fits]))
  return matched.flatMap((row) => {
    const { title, vendor, tags, colours, image_src, image_colour_src, image_colours, ...candidate } = row
    const fromWords = productFamilies({ title, vendor, tags, colours })
    const fromPhoto = image_src && image_colour_src === photoKey(image_src) ? familiesOfColours(image_colours ?? []) : []
    const offered = fromWords.length > 0 ? fromWords : fromPhoto
    const cut = namedCut([title, ...tags].join(' | '))
    candidate.sizes = [...new Set(candidate.sizes)]
    const slotIds = candidate.slot_ids.filter(
      (id) => colourCompatible(families.get(id) ?? null, offered) && cutCompatible(fits.get(id) ?? null, cut),
    )
    return slotIds.length > 0 ? [{ ...candidate, slot_ids: slotIds }] : []
  })
}

async function matchInSql(sql: Sql, targets: SlotTarget[], rates: Rates, productIds: number[] | null): Promise<Matched[]> {
  return sql<Matched[]>`
    with targets as (
      select * from jsonb_to_recordset(${sql.json(targets)})
        as t(slot_id bigint, garment_type text, kind text, min_cents integer, max_cents integer, sizes text[])
    ),
    rates as (
      select key as currency, value::numeric as rate from jsonb_each_text(${sql.json(rates)})
    ),
    latest_action as (
      select distinct on (product_id) product_id, action
      from feed_actions order by product_id, created_at desc, id desc
    ),
    matched as (
      select p.id as product_id, p.content_hash, p.title, p.vendor, p.tags,
             p.images -> 0 ->> 'src' as image_src, p.image_colour_src, p.image_colours, t.slot_id,
             t.sizes is not null as size_checked,
             v.id as variant_id, v.option_size, v.option_colour, v.size_key, v.price_cents, v.compare_at_cents
      from products p
      join retailers r on r.id = p.retailer_id and r.enabled
      join rates x on x.currency = r.currency
      join targets t on t.garment_type = p.garment_type and (t.kind is null or t.kind = p.garment_kind)
      join product_variants v on v.product_id = p.id and v.available and v.price_cents > 0
      where p.removed_at is null
        and p.menswear
        and (${productIds}::bigint[] is null or p.id = any (${productIds}::bigint[]))
        and (t.sizes is null or v.size_key = any (t.sizes))
        and (t.max_cents is null or v.price_cents * x.rate <= t.max_cents)
        and (t.min_cents is null
             or v.price_cents * x.rate >= t.min_cents
             or coalesce(v.compare_at_cents, 0) * x.rate >= t.min_cents)
        and not exists (
          select 1 from latest_action a
          where a.product_id = p.id and a.action in ('dismissed', 'bought')
        )
    )
    select product_id::int as product_id,
           content_hash, title, vendor, tags, image_src, image_colour_src, image_colours,
           coalesce(array_agg(distinct option_colour) filter (where option_colour is not null), '{}') as colours,
           array_agg(distinct slot_id::int order by slot_id::int) as slot_ids,
           -- In the store's own order (variants are stored as it lists them),
           -- not alphabetical; one row per slot repeats them, so they are
           -- de-duplicated when the rules run.
           coalesce(array_agg(option_size order by variant_id) filter (where option_size is not null), '{}') as sizes,
           bool_or(size_checked) or bool_and(coalesce(size_key = 'ONE', false)) as size_known,
           min(price_cents)::int as price_cents,
           (array_agg(compare_at_cents order by price_cents))[1]::int as compare_at_cents
    from matched
    group by product_id, content_hash, title, vendor, tags, image_src, image_colour_src, image_colours
    order by product_id
  `
}

export async function recordCandidates(sql: Sql, runId: number, candidates: Candidate[]): Promise<void> {
  for (let start = 0; start < candidates.length; start += 2000) {
    const rows = candidates.slice(start, start + 2000).map((candidate) => ({ run_id: runId, ...candidate }))
    await sql`insert into finder_candidates ${sql(rows)}`
  }
}
