import { db, type Sql } from './db.ts'
import { findCard, runRates, type FindCard, type FindRow, type Run } from './feed.ts'
import type { ProductImage } from './finder/shopify.ts'
import { QUALITIES, STATEMENT_THRESHOLD, type Quality } from './finder/statements.ts'
import type { PiecePhoto } from './pieces.ts'
import { outfitKey } from './outfit-key.ts'
import { latestTryOns, tryOnsByKey, type OnMe } from './try-on.ts'
import type { GarmentType } from './wardrobe-values.ts'

/*
 * The Statements page and its shelf on Finds: the statement pieces from the
 * latest run's shortlist that cleared the bar, best first, each with what
 * makes it one and the pieces of his it wears with. What he saved, dismissed
 * or bought leaves the shelf, as it leaves the feed. The run is found the way
 * the feed finds its own: the newest that recorded a shortlist, a run still
 * going included, so pieces appear as they are judged.
 */

export type StatementFind = FindCard & {
  garment_type: GarmentType
  qualities: Quality[]
  /** His pieces it wears with, those still in the wardrobe, in Claude's order. */
  wears_with: WornWith[]
  /** The kept picture of him in it with those pieces, if one was made. */
  outfit_on_me: OnMe | null
}

/** A piece it wears with, as the card draws it: his photo, else the shop's, else its colour. */
export type WornWith = {
  id: number
  name: string
  colour_hex: string | null
  photo: PiecePhoto | null
  image: ProductImage | null
}

export type Statements = {
  run: Run | null
  finds: StatementFind[]
  /** Every piece over the bar, before the quality filter and the limit. */
  total: number
  /** Over the bar for each quality, for the filter's counts. */
  byQuality: Record<Quality, number>
  /** On the shortlist and not judged yet: judged on the coming nights. */
  waiting: number
}

type Row = FindRow & {
  garment_type: GarmentType
  qualities: Quality[]
  wears_with: WornWith[]
}

/** The newest run with a statement shortlist; one marked running for three hours died. */
export async function statementRun(sql: Sql = db()): Promise<Run | null> {
  const [run] = await sql<Run[]>`
    select r.id::int as id, r.status, r.started_at, r.finished_at, r.stats from finder_runs r
    where (r.status = 'succeeded' or (r.status = 'running' and r.started_at > now() - interval '3 hours'))
      and exists (select 1 from statement_candidates c where c.run_id = r.id)
    order by r.started_at desc limit 1
  `
  return run ?? null
}

export async function getStatements(
  options: { quality?: Quality | null; limit?: number | null } = {},
  sql: Sql = db(),
): Promise<Statements> {
  const empty = { colour: 0, texture: 0, cut: 0 }
  const run = await statementRun(sql)
  if (!run) return { run: null, finds: [], total: 0, byQuality: empty, waiting: 0 }
  const rates = runRates(run)

  const rows = await sql<Row[]>`
    with latest_action as (
      select distinct on (product_id) product_id, action
      from feed_actions order by product_id, created_at desc, id desc
    )
    select c.product_id::int as product_id, null::int as slot_id, s.score, s.why,
           null::text as colour_verdict, null::text as fit_verdict, null::text as fabric_notes, s.colour_option,
           s.qualities, p.garment_type,
           p.title, p.vendor, p.url, p.main_image as image,
           r.name as retailer, r.country, r.currency, r.ships_to_nz, r.wellington_store,
           true as stock_known,
           c.price_cents, c.compare_at_cents, c.sizes, c.size_known,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', w.id, 'name', w.name, 'colour_hex', w.colour_hex, 'image', wp.main_image,
                      'photo', case when ph.id is null then null
                                    else jsonb_build_object('id', ph.id, 'width', ph.width, 'height', ph.height) end
                    ) order by k.place)
             from unnest(s.wears_with) with ordinality as k(piece_id, place)
             join wardrobe_pieces w on w.id = k.piece_id and w.set_aside_at is null
             left join products wp on wp.id = w.product_id
             left join wardrobe_photos ph on ph.id = w.photo_id
           ), '[]'::jsonb) as wears_with
    from statement_candidates c
    join statement_scores s on s.product_id = c.product_id and s.content_hash = c.content_hash
    join products p on p.id = c.product_id and p.removed_at is null
    -- A store switched off since the run goes from the shelf at once.
    join retailers r on r.id = p.retailer_id and r.enabled
    left join latest_action a on a.product_id = c.product_id
    where c.run_id = ${run.id}
      and s.score >= ${STATEMENT_THRESHOLD}
      and coalesce(a.action, 'cleared') = 'cleared'
    order by s.score desc, c.price_cents, c.product_id
  `
  const [counts] = await sql<{ waiting: number }[]>`
    select count(*)::int as waiting from statement_candidates c
    where c.run_id = ${run.id}
      and not exists (select 1 from statement_scores s where s.product_id = c.product_id and s.content_hash = c.content_hash)
  `

  const byQuality = { ...empty }
  for (const row of rows) for (const quality of row.qualities) byQuality[quality] += 1
  const chosen = options.quality ? rows.filter((row) => row.qualities.includes(options.quality!)) : rows
  const limited = options.limit ? chosen.slice(0, options.limit) : chosen
  const finds = limited.map((row) => ({
    ...findCard({ ...row, sizes: [...new Set(row.sizes)] }, rates),
    garment_type: row.garment_type,
    qualities: QUALITIES.filter((quality) => row.qualities.includes(quality)),
    wears_with: row.wears_with,
    outfit_on_me: null as OnMe | null,
  }))
  const outfits = finds.map((find) => (find.wears_with.length > 0 ? statementOutfitKey(find) : null))
  const [onMe, outfitsOnMe] = await Promise.all([
    latestTryOns(finds.map((find) => find.product_id), sql),
    tryOnsByKey(outfits.filter((key) => key !== null), sql),
  ])
  finds.forEach((find, index) => {
    find.on_me = onMe.get(find.product_id) ?? null
    const outfit = outfits[index]
    find.outfit_on_me = outfit ? (outfitsOnMe.get(outfit) ?? null) : null
  })
  return { run, finds, total: rows.length, byQuality, waiting: counts?.waiting ?? 0 }
}

/** The outfit its card puts on him: the find and the pieces it wears with. */
export function statementOutfitKey(find: Pick<StatementFind, 'product_id' | 'wears_with'>): string {
  return outfitKey([{ piece_id: null, product_id: find.product_id }, ...find.wears_with.map((piece) => ({ piece_id: piece.id }))])
}

/** "Colour and texture", "Cut": what makes it a statement, as the card's caption. */
export function qualitiesText(qualities: Quality[]): string {
  const words = qualities.map((quality, index) => (index === 0 ? quality[0]!.toUpperCase() + quality.slice(1) : quality))
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}
