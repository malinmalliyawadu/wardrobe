import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { dollars } from './blueprint.ts'
import { callUsd, claude, MODELS } from './claude.ts'
import { db, type Sql } from './db.ts'
import { findCard, type FindCard } from './feed.ts'
import { slotKind, wantedSizeKeys } from './finder/classify.ts'
import { familiesIn, productFamilies, slotFamilies } from './finder/colour.ts'
import { allowedFits, findCandidates, type Candidate, type Rates, type SlotTarget } from './finder/filter.ts'
import { loadRates } from './finder/fx.ts'
import { PoliteClient } from './finder/http.ts'
import { writePage } from './finder/ingest.ts'
import { fetchProduct } from './finder/product-link.ts'
import {
  costUsd,
  forScoring,
  plainText,
  scoreAll,
  SHOW_THRESHOLD,
  type ProductForScoring,
  type ScoreOutput,
  type Usage,
} from './finder/score.ts'
import { type ProductImage } from './finder/shopify.ts'
import { getFinderSettings, getSpend } from './finder/settings.ts'
import { getProfile, type Profile } from './profile.ts'
import { FITS } from './profile-values.ts'
import { listRetailers, STOCK_PLATFORMS, type WellingtonStore } from './retailers.ts'
import { getGuide, profileBrief, type Guide } from './style-guide.ts'
import { finalText, plainDashes } from './structured.ts'
import { latestTryOns } from './try-on.ts'
import { GARMENT_LABELS, GARMENT_TYPES, type GarmentType } from './wardrobe-values.ts'

/*
 * On-demand search (M5 Reach). Malin types what he wants on the Search tab;
 * the pipeline runs for that request at once, over what the nightly run last
 * read:
 *
 *   1. read     Sonnet turns the words into the filter's terms: garment,
 *               colours, price, fit, and a few words to rank by
 *   2. filter   the nightly filter, with the request as its one target (his
 *               size, the price, not plainly the wrong colour, not dismissed)
 *   3. score    Sonnet judges the closest matches against the request and his
 *               guide, within the search's spend; closest to his words first,
 *               so the cap cuts the furthest
 *   4. check    what the page will show is re-read from the shop, one request
 *               each, for a current price and stock in his size
 *
 * No blueprint slot is made. The request is the target, kept on the search;
 * a result he saves is saved without a slot, like a pasted link.
 */

/** The id the request goes by when the scorer is shown it as a slot. Never a real slot's id. */
export const SEARCH_SLOT = 0
/** The most products one search offers to Claude; the spend cap usually stops it well before. */
export const MAX_OFFERED = 150
/** The most results a search shows. */
export const MAX_SHOWN = 12
/** With nothing over the bar, the closest few are shown, if they reach this. */
export const CLOSEST_FLOOR = 50
const CLOSEST_SHOWN = 3
/** A search still running after this long died with its server. */
const STALE_MINUTES = 15
/** What one score costs, measured on the first nightly pass; the progress line paces by it. */
export const SCORE_USD_ESTIMATE = 0.0074
/** Below this there is not enough left to read the request and judge anything. */
const MIN_BUDGET_USD = 0.03

export class SearchError extends Error {}

// ---------------------------------------------------------------------------
// 1. Reading the request
// ---------------------------------------------------------------------------

export const RequestReadSchema = z.object({
  understood: z
    .boolean()
    .describe('True when this is a piece of menswear the shops could sell, specific enough to search for.'),
  garment_type: z
    .enum(GARMENT_TYPES)
    .nullable()
    .describe('The garment type from the fixed list that the request is for. Null when not understood.'),
  words: z
    .array(z.string())
    .describe(
      'One to four lowercase words a matching listing would use for this item, beyond its colour: "overshirt", "chelsea", "corduroy", "merino", "crewneck". Empty when the garment type says it all.',
    ),
  colours: z.array(z.string()).describe('The colour words he used, lowercase, as he wrote them. Empty when he named none.'),
  min_nzd: z.number().nullable().describe('The lowest price he asked for, in NZ dollars, or null.'),
  max_nzd: z.number().nullable().describe('The highest price he asked for, in NZ dollars, or null.'),
  fit: z.enum(FITS).nullable().describe('The cut he asked for, when he named one. Null otherwise.'),
  fabrics: z.array(z.string()).describe('Fabrics he named, lowercase. Empty when none.'),
  summary: z
    .string()
    .describe('His request as a short heading in his own terms, sentence case, under 60 characters: "A navy overshirt under $300".'),
  problem: z
    .string()
    .nullable()
    .describe('When not understood, one short sentence to him saying why and what to type instead. Null otherwise.'),
})

export type RequestRead = z.infer<typeof RequestReadSchema>

export const READ_SYSTEM_PROMPT = `You read one shopping request Malin typed into his private menswear app, and turn it into the terms the app's filter uses. The app then searches New Zealand menswear shops and END. (UK, ships to New Zealand) for products in his size, and a stylist judges the closest against his request and his style guide.

Garment types, and what each covers:
- tee: t-shirts
- tank: tank tops and singlets
- polo: polo shirts, including knitted polos
- shirt: shirts with a collar and buttons, short or long sleeved
- overshirt: overshirts and shirt jackets (shackets), worn over a tee
- knitwear: jumpers, cardigans, knitted vests, quarter zips in knit
- sweatshirt: sweatshirts and hoodies
- trousers: chinos, tailored and casual trousers, cargo pants
- jeans: jeans
- shorts: shorts, including swim shorts
- tailoring: suits, blazers and sport coats
- jacket: jackets: bomber, chore, field, trucker, harrington, rain shell, puffer, gilet
- coat: overcoats, topcoats, trench coats, peacoats, parkas
- activewear: running and gym kit
- shoes: dress and casual shoes, loafers, derbies
- boots: boots, including chelsea and chukka
- sneakers: sneakers and trainers
- belt: belts
- accessory: scarves, beanies, caps, watches, socks, ties, sunglasses
- bag: bags

Prices are in New Zealand dollars: "under $300" is a maximum of 300; "around $200" is about 160 to 240. A request may name a colour, a cut, a fabric, a price, all of these or none.

It is not understood when it is not a piece of clothing, footwear or an accessory, when it is womenswear, or when it is too vague to search for ("something nice"). Then say why in one short sentence to him, in the second person. Use a plain hyphen rather than a dash.`

function readRequestRequest(request: string) {
  // Without `parse`, the SDK passes the schema through and leaves the text alone.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parse: _parse, ...format } = zodOutputFormat(RequestReadSchema)
  return {
    model: MODELS.scoring,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: READ_SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: `His request: ${JSON.stringify(request)}` }],
    output_config: { effort: 'low' as const, format },
  }
}

/** Sonnet reads the request. Returns what it cost even when the read is unusable. */
export async function readRequest(request: string): Promise<{ read: RequestRead | null; usd: number }> {
  const response = await claude().beta.messages.create(readRequestRequest(request), { maxRetries: 3 })
  const usd = callUsd(MODELS.scoring, response.usage)
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return { read: null, usd }
  let json: unknown
  try {
    json = JSON.parse(finalText(response.content))
  } catch {
    return { read: null, usd }
  }
  const parsed = RequestReadSchema.safeParse(json)
  return { read: parsed.success ? (plainDashes(parsed.data) as RequestRead) : null, usd }
}

// ---------------------------------------------------------------------------
// 2. The request as the filter's target
// ---------------------------------------------------------------------------

export type SearchTarget = SlotTarget & {
  words: string[]
  colours: string[]
  fabrics: string[]
  fit: string | null
}

/**
 * The read as a slot target: the garment, the kind for an accessory, his size
 * from the profile, the price, the colour families he named and their
 * neighbours, and the cuts allowed (his, when he named one, else the guide's).
 */
export function searchTarget(
  read: RequestRead & { garment_type: GarmentType },
  sizes: Profile['sizes'],
  guideFits: (garment: GarmentType) => string[],
): SearchTarget {
  const words = tidyWords([...read.words, ...read.fabrics])
  const cents = (nzd: number | null) => (nzd === null || !(nzd > 0) ? null : Math.round(nzd * 100))
  let min = cents(read.min_nzd)
  let max = cents(read.max_nzd)
  if (min !== null && max !== null && min > max) [min, max] = [max, min]
  return {
    slot_id: SEARCH_SLOT,
    garment_type: read.garment_type,
    kind: slotKind(read.garment_type, [read.summary, ...read.words].join(' ')),
    min_cents: min,
    max_cents: max,
    sizes: wantedSizeKeys(read.garment_type, [], sizes),
    families: slotFamilies(read.colours),
    fits: read.fit ? [read.fit] : allowedFits(null, guideFits(read.garment_type)),
    words,
    colours: tidyWords(read.colours),
    fabrics: tidyWords(read.fabrics),
    fit: read.fit,
  }
}

function tidyWords(words: string[]): string[] {
  return [...new Set(words.map((word) => word.trim().toLowerCase()).filter((word) => word.length > 1))]
}

/** "overshirts" finds "overshirt" and "overshirts"; short words match whole. */
function stem(word: string): string {
  return word.length > 4 ? word.replace(/(es|s)$/, '') : word
}

function hits(text: string, words: string[]): number {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  return words.filter((word) => haystack.includes(` ${stem(word)}`)).length
}

/**
 * The candidates in the order they are offered to Claude: his words in the
 * title count twice, in the type, tags or description once; then a colour
 * he named that the listing names too; then the store's newest first. A
 * stable order, so a cap always cuts the furthest from what he typed.
 */
export function rankForRequest<T extends Pick<ProductForScoring, 'product_id' | 'title' | 'vendor' | 'product_type' | 'tags' | 'body_html' | 'colours'>>(
  products: T[],
  target: Pick<SearchTarget, 'words' | 'colours'>,
): T[] {
  const asked = new Set(target.colours.flatMap(familiesIn))
  const weight = (product: T) => {
    const words =
      2 * hits(product.title, target.words) +
      hits([product.product_type ?? '', ...product.tags, plainText(product.body_html)].join(' '), target.words)
    const named = productFamilies({ title: product.title, vendor: product.vendor, colours: product.colours, tags: product.tags })
    const colour = asked.size > 0 && named.some((family) => asked.has(family)) ? 1 : 0
    return words * 2 + colour
  }
  return products
    .map((product) => ({ product, weight: weight(product) }))
    .sort((a, b) => b.weight - a.weight || b.product.product_id - a.product.product_id)
    .map(({ product }) => product)
}

// ---------------------------------------------------------------------------
// 3. What the scorer is told
// ---------------------------------------------------------------------------

export const SEARCH_PREAMBLE = `This is not the nightly run. He typed a request into the app just now, and every product below is judged against that request alone: it is the only slot, id ${SEARCH_SLOT}. His words decide what the slot is. Where they part from his guide (a colour from his avoid list, a cut the guide advises against), judge the product as what he asked for, say plainly in the verdict how it sits with his guide, and keep the score under 75.`

export function searchContextBlock(context: {
  profile: Profile
  guide: Guide
  request: string
  summary: string
  target: SearchTarget
  dismissals: { title: string; reason: string | null; note: string | null }[]
}): string {
  const { target } = context
  const slot = {
    id: SEARCH_SLOT,
    name: context.summary,
    why: `He asked for this himself: ${JSON.stringify(context.request)}`,
    garment_type: target.garment_type,
    colour_family: target.colours.length > 0 ? target.colours.join(', ') : null,
    fabrics: target.fabrics,
    fit: target.fit,
    budget_nzd: { min: dollars(target.min_cents), max: dollars(target.max_cents) },
  }
  const parts = [
    SEARCH_PREAMBLE,
    `His profile:\n\n${JSON.stringify(profileBrief(context.profile))}`,
    `His style guide:\n\n${JSON.stringify({
      palette: context.guide.palette,
      silhouette: context.guide.silhouette,
      shoes: context.guide.shoes,
      accessories: context.guide.accessories,
      fit_vocabulary: context.guide.fit_vocabulary,
    })}`,
    `His request, the one slot to judge against:\n\n${JSON.stringify([slot])}`,
  ]
  if (context.dismissals.length > 0) {
    parts.push(`Products he dismissed lately, most recent first:\n\n${JSON.stringify(context.dismissals)}`)
  }
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Starting and running a search
// ---------------------------------------------------------------------------

export type SearchStarted = { ok: true; id: number } | { ok: false; message: string }

/** What one search may spend: the per-search cap, held under what is left of the month. */
export function searchBudget(perSearch: number, perMonth: number | null, spentThisMonth: number): number {
  const left = perMonth === null ? perSearch : Math.max(0, perMonth - spentThisMonth)
  return Math.round(Math.min(perSearch, left) * 10000) / 10000
}

export async function sweepStale(sql: Sql): Promise<void> {
  await sql`
    update searches set status = 'failed', finished_at = now(), error = 'It stopped part way. Try again.'
    where status in ('reading', 'filtering', 'scoring', 'checking')
      and started_at < now() - make_interval(mins => ${STALE_MINUTES})
  `
}

/** Records a search, or says why it cannot run. The work is done by runSearch, after the response. */
export async function startSearch(request: string, sql: Sql = db()): Promise<SearchStarted> {
  const text = request.trim().replace(/\s+/g, ' ')
  if (text.length < 2) return { ok: false, message: 'Say what you are after.' }
  if (text.length > 200) return { ok: false, message: 'Keep it under 200 characters.' }
  const [guide, settings, spend] = await Promise.all([getGuide(), getFinderSettings(sql), getSpend(sql)])
  if (!guide) return { ok: false, message: 'Search judges against your style guide. Draft it on the Blueprint tab first.' }
  const budget = searchBudget(settings.max_usd_per_search, settings.max_usd_per_month, spend.thisMonth)
  if (budget < MIN_BUDGET_USD) {
    return {
      ok: false,
      message:
        settings.max_usd_per_search < MIN_BUDGET_USD
          ? 'Searching is off: its limit on You, Finder is below US$0.03.'
          : 'This month’s limit is spent. Raise it on You, Finder to search again.',
    }
  }
  await sweepStale(sql)
  try {
    const [row] = await sql<{ id: number }[]>`
      insert into searches (request, max_usd) values (${text}, ${budget}) returning id::int as id
    `
    return { ok: true, id: row!.id }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, message: 'Another search is still running. One at a time.' }
    }
    throw error
  }
}

type Log = (fields: Record<string, unknown>) => void

export type SearchStats = {
  read_usd?: number
  stores_on?: number
  matched?: number
  candidates?: number
  offered?: number
  scored?: number
  failed?: number
  skipped_for_budget?: number
  shown?: number
  checked?: number
  gone?: number
  seconds?: number
  fx?: { rates: Rates; source: string; date: string | null }
}

/**
 * Runs a recorded search to the end. Never throws: whatever goes wrong ends
 * as a failed row with words for the page.
 */
export async function runSearch(
  id: number,
  options: {
    sql?: Sql
    log?: Log
    client?: PoliteClient
    /** Tests pass fakes for the two Claude calls. */
    read?: typeof readRequest
    scoreOne?: Parameters<typeof scoreAll>[4]['scoreOne']
  } = {},
): Promise<'done' | 'failed'> {
  const sql = options.sql ?? db()
  const log = options.log ?? (() => {})
  const started = Date.now()
  const [search] = await sql<{ request: string; max_usd: number }[]>`
    select request, max_usd::float as max_usd from searches where id = ${id} and status = 'reading'
  `
  if (!search) return 'failed'
  const stats: SearchStats = {}
  let spent = 0
  const save = async (
    status: SearchStatus,
    extra: { target?: SearchTarget; summary?: string; error?: string; finished?: boolean } = {},
  ) => {
    await sql`
      update searches set
        status = ${status}, usd = ${spent}, stats = ${sql.json(stats as never)},
        target = coalesce(${extra.target ? sql.json(extra.target as never) : null}, target),
        summary = coalesce(${extra.summary ?? null}, summary),
        error = coalesce(${extra.error ?? null}, error),
        finished_at = ${extra.finished ? sql`now()` : sql`finished_at`}
      where id = ${id}
    `
  }

  try {
    // 1. Read.
    const { read, usd } = await (options.read ?? readRequest)(search.request)
    spent += usd
    stats.read_usd = Number(usd.toFixed(6))
    if (!read) throw new SearchError('Claude could not read that. Try putting it another way.')
    if (!read.understood || !read.garment_type) {
      throw new SearchError(read.problem ?? 'That is not something the shops sell. Name a piece of menswear.')
    }
    const [profile, guide, retailers] = await Promise.all([getProfile(), getGuide(), listRetailers(sql)])
    if (!guide) throw new SearchError('Search judges against your style guide. Draft it first.')
    const target = searchTarget(
      { ...read, garment_type: read.garment_type },
      profile.sizes,
      (garment) => guide.fit_vocabulary.find((entry) => entry.garment === garment)?.fits ?? [],
    )
    await save('filtering', { target, summary: read.summary })

    // 2. Filter, over what the nightly run last read.
    const on = retailers.filter((retailer) => retailer.enabled)
    stats.stores_on = on.length
    const fx = await loadRates(sql, on.map((retailer) => retailer.currency))
    stats.fx = fx
    const { candidates, stats: filtered } = await findCandidates(sql, [target], fx.rates)
    stats.matched = filtered.matched
    stats.candidates = candidates.length
    // What he has already saved is in Saved on Today; it is not paid for twice.
    const saved = new Set(await savedProductIds(sql))
    const fresh = candidates.filter((candidate) => !saved.has(candidate.product_id))
    const ranked = rankForRequest(await forScoring(sql, fresh, { onlyUnscored: false }), target).slice(0, MAX_OFFERED)
    stats.offered = ranked.length
    const byId = new Map(candidates.map((candidate) => [candidate.product_id, candidate]))
    if (ranked.length > 0) {
      await sql`
        insert into search_results ${sql(
          ranked.map((product, rank) => {
            const candidate = byId.get(product.product_id)!
            return {
              search_id: id,
              product_id: product.product_id,
              content_hash: product.content_hash,
              rank,
              sizes: candidate.sizes,
              size_known: candidate.size_known,
              price_cents: candidate.price_cents,
              compare_at_cents: candidate.compare_at_cents,
            }
          }),
        )}
      `
    }
    await save('scoring')
    log({ event: 'search.filtered', id, matched: stats.matched, candidates: stats.candidates, offered: stats.offered })

    // 3. Score, closest first, within what is left after the read.
    if (ranked.length > 0) {
      const context = searchContextBlock({
        profile,
        guide,
        request: search.request,
        summary: read.summary,
        target,
        dismissals: await recentDismissals(sql),
      })
      const scoring = await scoreAll(sql, id, context, ranked, {
        maxUsd: Math.max(0, search.max_usd - spent),
        concurrency: 6,
        log,
        scoreOne: options.scoreOne,
        save: saveResult,
      })
      spent += scoring.usd
      stats.scored = scoring.scored
      stats.failed = scoring.failed
      stats.skipped_for_budget = scoring.skipped_for_budget
      if (scoring.scored === 0 && scoring.failed > 0) {
        throw new SearchError('Claude did not answer. Try again in a minute.')
      }
    }
    await save('checking')

    // 4. Re-read what will be shown, for a current price and stock in his size.
    const shown = await toShow(sql, id)
    const checked = await recheck(sql, options.client ?? new PoliteClient(), id, shown, target, fx.rates)
    stats.checked = checked.checked
    stats.gone = checked.gone
    stats.shown = (await toShow(sql, id)).length
    stats.seconds = Math.round((Date.now() - started) / 1000)
    await save('done', { finished: true })
    log({ event: 'search.done', id, ...stats, usd: spent })
    return 'done'
  } catch (error) {
    if (!(error instanceof SearchError)) console.error('search: failed', error)
    const message =
      error instanceof SearchError
        ? error.message
        : error instanceof Anthropic.APIError
          ? 'Claude did not answer. Try again in a minute.'
          : 'Something went wrong. Try again.'
    stats.seconds = Math.round((Date.now() - started) / 1000)
    await save('failed', { finished: true, error: message })
    return 'failed'
  }
}

/** The scorer's verdict, kept on the search rather than in product_scores. */
async function saveResult(
  sql: Sql,
  searchId: number,
  product: ProductForScoring,
  output: ScoreOutput,
  usage: Usage,
  servedBy: string,
): Promise<void> {
  // The request is the only slot it was offered; a "none" from Claude still carries the score it gave.
  await sql`
    update search_results set
      score = ${output.score}, colour_option = ${output.colour}, colour_verdict = ${output.colour_verdict},
      fit_verdict = ${output.fit_verdict}, fabric_notes = ${output.fabric_notes}, why = ${output.why},
      model = ${MODELS.scoring}, served_by = ${servedBy},
      input_tokens = ${usage.input}, output_tokens = ${usage.output},
      cache_read_tokens = ${usage.cacheRead}, cache_write_tokens = ${usage.cacheWrite},
      usd = ${costUsd(usage)}, scored_at = now()
    where search_id = ${searchId} and product_id = ${product.product_id}
  `
}

async function savedProductIds(sql: Sql): Promise<number[]> {
  const rows = await sql<{ product_id: number }[]>`
    select product_id::int as product_id from (
      select distinct on (product_id) product_id, action
      from feed_actions order by product_id, created_at desc, id desc
    ) latest
    where action = 'saved'
  `
  return rows.map((row) => row.product_id)
}

async function recentDismissals(sql: Sql) {
  return sql<{ title: string; reason: string | null; note: string | null }[]>`
    select p.title, a.reason, a.note from feed_actions a join products p on p.id = a.product_id
    where a.action = 'dismissed'
    order by a.created_at desc limit 40
  `
}

/**
 * What the page shows: the results over the bar, best first, that are still
 * in stock and that he has not saved, dismissed or bought since; with none
 * over the bar, the closest few.
 */
async function toShow(sql: Sql, searchId: number): Promise<{ product_id: number; score: number }[]> {
  const rows = await sql<{ product_id: number; score: number }[]>`
    with latest_action as (
      select distinct on (product_id) product_id, action
      from feed_actions order by product_id, created_at desc, id desc
    )
    select r.product_id::int as product_id, r.score
    from search_results r
    join products p on p.id = r.product_id and p.removed_at is null
    left join latest_action a on a.product_id = r.product_id
    where r.search_id = ${searchId} and r.in_stock and r.score >= ${CLOSEST_FLOOR}
      and coalesce(a.action, 'cleared') = 'cleared'
    order by r.score desc, r.price_cents, r.rank
  `
  const over = rows.filter((row) => row.score >= SHOW_THRESHOLD)
  return over.length > 0 ? over.slice(0, MAX_SHOWN) : rows.slice(0, CLOSEST_SHOWN)
}

/**
 * Reads each product the page will show from its shop, stores it like any
 * other read, and runs the filter again over those products alone: one the
 * shop no longer has, or no longer has in his size or price, is marked out of
 * stock; the rest get their current sizes and price.
 */
async function recheck(
  sql: Sql,
  client: PoliteClient,
  searchId: number,
  shown: { product_id: number }[],
  target: SearchTarget,
  rates: Rates,
): Promise<{ checked: number; gone: number }> {
  if (shown.length === 0) return { checked: 0, gone: 0 }
  const ids = shown.map((row) => row.product_id)
  const rows = await sql<{ id: number; retailer_id: number; handle: string | null }[]>`
    select id::int as id, retailer_id::int as retailer_id, handle from products where id = any (${ids}::bigint[])
  `
  const retailers = new Map((await listRetailers(sql)).map((retailer) => [retailer.id, retailer]))
  const goneIds = new Set<number>()
  let checked = 0
  await Promise.all(
    rows.map(async (row) => {
      const retailer = retailers.get(row.retailer_id)
      if (!retailer || !row.handle) return
      try {
        const product = await fetchProduct(client, retailer, row.handle)
        checked += 1
        if (!product) {
          goneIds.add(row.id)
          return
        }
        await writePage(sql, retailer.id, [product])
      } catch {
        // The shop did not answer: last night's read stands.
      }
    }),
  )
  const { candidates } = await findCandidates(sql, [target], rates, { productIds: ids })
  const now = new Map<number, Candidate>(candidates.map((candidate) => [candidate.product_id, candidate]))
  let gone = 0
  for (const productId of ids) {
    const candidate = goneIds.has(productId) ? undefined : now.get(productId)
    if (!candidate) gone += 1
    if (candidate) {
      await sql`
        update search_results set sizes = ${candidate.sizes}, size_known = ${candidate.size_known},
          price_cents = ${candidate.price_cents}, compare_at_cents = ${candidate.compare_at_cents}, checked_at = now()
        where search_id = ${searchId} and product_id = ${productId}
      `
    } else {
      await sql`
        update search_results set in_stock = false, checked_at = now()
        where search_id = ${searchId} and product_id = ${productId}
      `
    }
  }
  return { checked, gone }
}

// ---------------------------------------------------------------------------
// Reading searches for the pages
// ---------------------------------------------------------------------------

export type SearchStatus = 'reading' | 'filtering' | 'scoring' | 'checking' | 'done' | 'failed'

export type SearchSummary = {
  id: number
  request: string
  summary: string | null
  status: SearchStatus
  error: string | null
  usd: number
  max_usd: number
  started_at: Date
  finished_at: Date | null
  /** Results over the bar, still in stock. */
  finds: number
}

export type SearchView = SearchSummary & {
  target: SearchTarget | null
  stats: SearchStats
  offered: number
  scored: number
  results: FindCard[]
  /** True when nothing cleared the bar and these are the closest. */
  closest: boolean
}

export const RUNNING: SearchStatus[] = ['reading', 'filtering', 'scoring', 'checking']

const STATUS_COLUMNS = (sql: Sql) => sql`
  case when s.status in ('reading', 'filtering', 'scoring', 'checking')
            and s.started_at < now() - make_interval(mins => ${STALE_MINUTES})
       then 'failed' else s.status end as status,
  case when s.status in ('reading', 'filtering', 'scoring', 'checking')
            and s.started_at < now() - make_interval(mins => ${STALE_MINUTES})
       then 'It stopped part way. Try again.' else s.error end as error
`

export async function listSearches(limit = 12, sql: Sql = db()): Promise<SearchSummary[]> {
  return sql<SearchSummary[]>`
    select s.id::int as id, s.request, s.summary, ${STATUS_COLUMNS(sql)},
           s.usd::float as usd, s.max_usd::float as max_usd, s.started_at, s.finished_at,
           (select count(*) from search_results r
             where r.search_id = s.id and r.in_stock and r.score >= ${SHOW_THRESHOLD})::int as finds
    from searches s
    order by s.started_at desc
    limit ${limit}
  `
}

type ResultRow = {
  product_id: number
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
  currency: string
  ships_to_nz: boolean
  wellington_store: WellingtonStore | null
  price_cents: number
  compare_at_cents: number | null
  sizes: string[]
  size_known: boolean
  stock_known: boolean
}

export async function getSearch(id: number, sql: Sql = db()): Promise<SearchView | null> {
  const [row] = await sql<(SearchSummary & { target: SearchTarget | null; stats: SearchStats; offered: number; scored: number })[]>`
    select s.id::int as id, s.request, s.summary, ${STATUS_COLUMNS(sql)},
           s.usd::float as usd, s.max_usd::float as max_usd, s.started_at, s.finished_at, s.target, s.stats,
           (select count(*) from search_results r where r.search_id = s.id)::int as offered,
           (select count(*) from search_results r where r.search_id = s.id and r.scored_at is not null)::int as scored,
           (select count(*) from search_results r
             where r.search_id = s.id and r.in_stock and r.score >= ${SHOW_THRESHOLD})::int as finds
    from searches s where s.id = ${id}
  `
  if (!row) return null
  if (row.status !== 'done') return { ...row, results: [], closest: false }

  const shown = await toShow(sql, id)
  const rates: Rates = { NZD: 1, ...(row.stats.fx?.rates ?? {}) }
  const rows = shown.length
    ? await sql<ResultRow[]>`
        select r.product_id::int as product_id, r.score, r.why, r.colour_verdict, r.fit_verdict, r.fabric_notes,
               r.colour_option, p.title, p.vendor, p.url, p.main_image as image,
               rt.name as retailer, rt.country, rt.currency, rt.ships_to_nz, rt.wellington_store,
               rt.platform = any (${[...STOCK_PLATFORMS]}::text[]) as stock_known,
               r.price_cents, r.compare_at_cents, r.sizes, r.size_known
        from search_results r
        join products p on p.id = r.product_id
        join retailers rt on rt.id = p.retailer_id
        where r.search_id = ${id} and r.product_id = any (${shown.map((result) => result.product_id)}::bigint[])
      `
    : []
  const order = new Map(shown.map((result, index) => [result.product_id, index]))
  const results = rows
    .sort((a, b) => order.get(a.product_id)! - order.get(b.product_id)!)
    .map((result) => findCard({ ...result, slot_id: null }, rates))
  const onMe = await latestTryOns(results.map((result) => result.product_id), sql)
  for (const result of results) result.on_me = onMe.get(result.product_id) ?? null
  return { ...row, results, closest: results.length > 0 && results.every((result) => result.score < SHOW_THRESHOLD) }
}

/** "Overshirts in navy or blue, $150 to $300, in your M." from the read, for the line under the heading. */
export function targetLine(target: SearchTarget): string {
  const garment = GARMENT_LABELS[target.garment_type].toLowerCase()
  const plural = /s$/.test(garment) ? garment : `${garment}s`
  const noun = target.kind ? `${target.kind}s` : plural
  const parts = [target.colours.length > 0 ? `${noun} in ${target.colours.join(' or ')}` : noun]
  if (target.fit) parts.push(`${target.fit} cut`)
  const dollarsText = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-NZ')}`
  if (target.min_cents !== null && target.max_cents !== null) {
    parts.push(`${dollarsText(target.min_cents)} to ${dollarsText(target.max_cents)}`)
  } else if (target.max_cents !== null) {
    parts.push(`up to ${dollarsText(target.max_cents)}`)
  } else if (target.min_cents !== null) {
    parts.push(`from ${dollarsText(target.min_cents)}`)
  }
  parts.push(target.sizes ? 'in your size' : 'in any size in stock')
  const [first, ...rest] = parts
  const line = [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(', ')
  return `${line}.`
}
