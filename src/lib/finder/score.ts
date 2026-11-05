import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { dollars, type Slot } from '../blueprint.ts'
import { MODELS, PRICES, claude } from '../claude.ts'
import type { Sql } from '../db.ts'
import { productImageAt } from '../product-image.ts'
import type { Profile } from '../profile.ts'
import { finalText, plainDashes } from '../structured.ts'
import { colourNameFor, profileBrief, type Guide } from '../style-guide.ts'

import type { Candidate } from './filter.ts'
import type { ProductImage } from './shopify.ts'

/*
 * Stage 3: Claude judges each candidate the filter let through, once per
 * version of the product. Sonnet, because this is volume work; adaptive
 * thinking at low effort, the starting point for classification. Everything
 * that is the same for every product in a run (instructions, his profile, the
 * guide, the open slots, what he dismissed lately) is one cached system
 * prefix, so each call pays full price only for the product and its picture.
 */

export const SHOW_THRESHOLD = 70

/** Sonnet 5.5 list prices, USD per million tokens. */
export const SONNET_PRICES = PRICES[MODELS.scoring]

export const ScoreSchema = z.object({
  slot_id: z
    .number()
    .int()
    .nullable()
    .describe('The id of the compatible slot this product fills best, or null if it fills none of them well.'),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('0 to 100 against that slot, using the scale in the instructions.'),
  colour: z
    .string()
    .nullable()
    .describe('The colour option you judged, copied exactly from the colours offered in his size, or null when there is only one.'),
  colour_verdict: z
    .string()
    .describe('A few words on the colour against his palette, naming the nearest palette colour: "close to your pine, reads slightly cooler".'),
  fit_verdict: z.string().describe('A few words on the cut against his fit and proportion rules.'),
  fabric_notes: z.string().describe('A few words on fabric and make from the description, or "not stated".'),
  why: z
    .string()
    .describe('One sentence to him, under 25 words, saying why this does or does not fill the slot. Plain and specific, no sales talk.'),
  alternatives: z
    .array(z.object({ slot_id: z.number().int(), score: z.number().int().min(0).max(100) }))
    .describe('Other compatible slots it could also fill, with their scores. Empty when there are none.'),
})

export type ScoreOutput = z.infer<typeof ScoreSchema>

export const SCORE_SYSTEM_PROMPT = `You are an experienced menswear stylist working for one client. Every night a private app reads New Zealand menswear shops and END. (UK, ships to New Zealand), keeps the products that are the right garment, in his size and inside his budget, and asks you about each one. You have his profile, his style guide and the open slots of his wardrobe blueprint: each slot is an archetype he wants to buy, such as "pine fine-gauge merino crewneck".

For each product you get its photo, its listing and the ids of the slots it could fill by garment type. Decide which of those slots it fills best, if any, and score it against that slot.

Scale:
- 90 to 100: buy this. The slot's archetype, a colour from his best colours or neutrals, a cut that follows his rules, and fabric that earns the price.
- 75 to 89: a strong match worth his attention, with one small compromise you name.
- 60 to 74: plausible, but a real compromise: the colour is near his palette rather than in it, the fabric is weaker than the slot asks, or the cut is uncertain.
- 40 to 59: wrong in one important way.
- Below 40: not the slot's archetype, or not for him.

Colour is the point of the app, so judge it from the photo as well as the name: a listing called "olive" can photograph khaki, and studio light flatters. Compare against his palette hexes and say which palette colour it is closest to. A colour from his avoid list near the face scores below 40. When several colours are offered in his size, judge the best of them for him and name it.

Judge the cut against the slot's fit and the guide's rules for his height and build, from what the photo and listing show. Graphics, slogans and large logos count against a slot that does not ask for them. Respect his no-gos absolutely. Products he dismissed lately, with his reason, tell you what he does not want; weigh similar products down.

Price is not your concern: the app has already checked the budget band. Do not invent facts the listing does not give; say "not stated". Write to him in the second person, in plain English, and use a plain hyphen rather than a dash.`

export type ScoringContext = {
  profile: Profile
  guide: Guide
  slots: Slot[]
  dismissals: { title: string; reason: string | null; note: string | null }[]
}

/**
 * The cached half of every call. Its text must not change within a run. JSON
 * is written compact: it is read from the cache on every call, and the
 * indentation was a third of it.
 */
export function contextBlock(context: ScoringContext): string {
  const slots = context.slots.map((slot) => ({
    id: slot.id,
    name: slot.name,
    why: slot.why,
    priority: slot.priority,
    garment_type: slot.garment_type,
    colour_family: slot.colour_family,
    colours: slot.colours.map((hex) => ({ hex, name: colourNameFor(context.guide, hex) })),
    fabrics: slot.fabrics,
    fit: slot.fit,
    budget_nzd: { min: dollars(slot.budget_min_cents), max: dollars(slot.budget_max_cents) },
  }))
  const parts = [
    `His profile:\n\n${JSON.stringify(profileBrief(context.profile))}`,
    `His style guide:\n\n${JSON.stringify(
      {
        palette: context.guide.palette,
        silhouette: context.guide.silhouette,
        shoes: context.guide.shoes,
        accessories: context.guide.accessories,
        fit_vocabulary: context.guide.fit_vocabulary,
      },
    )}`,
    `The open slots of his blueprint:\n\n${JSON.stringify(slots)}`,
  ]
  if (context.dismissals.length > 0) {
    parts.push(`Products he dismissed lately, most recent first:\n\n${JSON.stringify(context.dismissals)}`)
  }
  return parts.join('\n\n')
}

export type ProductForScoring = {
  product_id: number
  content_hash: string
  retailer: string
  title: string
  vendor: string | null
  product_type: string | null
  tags: string[]
  body_html: string | null
  images: ProductImage[]
  /** Colour options in stock in his size. */
  colours: string[]
  sizes: string[]
  slot_ids: number[]
}

export const IMAGE_WIDTH = 768

export function buildScoreRequest(context: string, product: ProductForScoring) {
  const listing = {
    retailer: product.retailer,
    title: product.title,
    brand: product.vendor,
    product_type: product.product_type,
    tags: product.tags.slice(0, 24),
    description: plainText(product.body_html).slice(0, 1500) || null,
    colours_in_his_size: product.colours,
    sizes_in_stock: product.sizes,
  }
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  const image = product.images[0]
  if (image) content.push({ type: 'image', source: { type: 'url', url: productImageAt(image.src, IMAGE_WIDTH) } })
  content.push({
    type: 'text',
    text: [
      image ? 'The product photo is above.' : 'The listing has no photo.',
      `The listing:\n\n${JSON.stringify(listing, null, 2)}`,
      `Slots it could fill by garment type: ${JSON.stringify(product.slot_ids)}.`,
    ].join('\n\n'),
  })

  // Without `parse`, the SDK passes the schema through and leaves the text alone.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parse: _parse, ...format } = zodOutputFormat(ScoreSchema)
  return {
    model: MODELS.scoring,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: [
      { type: 'text' as const, text: SCORE_SYSTEM_PROMPT },
      { type: 'text' as const, text: context, cache_control: { type: 'ephemeral' as const } },
    ],
    messages: [{ role: 'user' as const, content }],
    output_config: { effort: 'low' as const, format },
  }
}

/** Holds Claude to the slots it was offered and the colours on sale. */
export function tidyScore(output: ScoreOutput, product: Pick<ProductForScoring, 'slot_ids' | 'colours'>): ScoreOutput {
  const offered = new Set(product.slot_ids)
  const alternatives = output.alternatives.filter((alt) => offered.has(alt.slot_id))
  let slotId = output.slot_id !== null && offered.has(output.slot_id) ? output.slot_id : null
  let score = output.score
  if (slotId === null && output.slot_id !== null) {
    // It named a slot it was not offered: fall back to its best offered alternative.
    const best = [...alternatives].sort((a, b) => b.score - a.score)[0]
    slotId = best?.slot_id ?? null
    score = best ? Math.min(best.score, output.score) : output.score
  }
  const colour = output.colour !== null && product.colours.includes(output.colour) ? output.colour : null
  const tidied = plainDashes({
    ...output,
    slot_id: slotId,
    score: Math.max(0, Math.min(100, Math.round(score))),
    colour,
    alternatives: alternatives.filter((alt) => alt.slot_id !== slotId),
  }) as ScoreOutput
  return tidied
}

export type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number }

export function costUsd(usage: Usage): number {
  return (
    (usage.input * SONNET_PRICES.input +
      usage.output * SONNET_PRICES.output +
      usage.cacheWrite * SONNET_PRICES.cacheWrite +
      usage.cacheRead * SONNET_PRICES.cacheRead) /
    1_000_000
  )
}

export class ScoreError extends Error {}

const MAX_API_ERRORS_IN_A_ROW = 10

export async function scoreProduct(
  context: string,
  product: ProductForScoring,
): Promise<{ output: ScoreOutput; usage: Usage; servedBy: string }> {
  const response = await claude().beta.messages.create(buildScoreRequest(context, product), { maxRetries: 5 })
  const usage: Usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
  }
  if (response.stop_reason === 'refusal') throw new ScoreUsageError('declined', usage)
  if (response.stop_reason === 'max_tokens') throw new ScoreUsageError('cut off', usage)
  const parsed = ScoreSchema.safeParse(parseJson(finalText(response.content)))
  if (!parsed.success) throw new ScoreUsageError('unexpected shape', usage)
  return { output: tidyScore(parsed.data, product), usage, servedBy: response.model }
}

/** A failed call that still cost tokens, so the run's cost stays honest. */
export class ScoreUsageError extends ScoreError {
  readonly usage: Usage

  constructor(message: string, usage: Usage) {
    super(message)
    this.usage = usage
  }
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export type ScoreStats = {
  needed: number
  scored: number
  failed: number
  skipped_for_budget: number
  /** Left unscored because the API kept refusing (no credit, an outage): tried again next run. */
  skipped_for_errors: number
  /** Why the stage stopped early, if it did. */
  stopped: string | null
  failures: Record<string, number>
  tokens: Usage
  usd: number
  seconds: number
}

export type Log = (fields: Record<string, unknown>) => void

/**
 * Candidates that need a score: no score for the product's current version,
 * or one older than a slot it is now offered (a slot drafted or edited since).
 * A status change (saved, owned) is not an edit, so it never re-scores.
 * Highest-priority slot first, so a spending cap cuts the least important.
 */
export async function unscored(sql: Sql, candidates: Candidate[], slots: Slot[]): Promise<ProductForScoring[]> {
  const rank = new Map(slots.map((slot, index) => [slot.id, index]))
  const products = await forScoring(sql, candidates, { onlyUnscored: true })
  return products.sort(
    (a, b) => firstRank(a.slot_ids, rank) - firstRank(b.slot_ids, rank) || a.product_id - b.product_id,
  )
}

/**
 * What the scorer is shown of each candidate, in the candidates' order. With
 * onlyUnscored, those whose current version already has a verdict newer than
 * every slot it is offered are left out (the nightly run); a search scores
 * all of them against its own request.
 */
export async function forScoring(
  sql: Sql,
  candidates: Candidate[],
  { onlyUnscored }: { onlyUnscored: boolean },
): Promise<ProductForScoring[]> {
  if (candidates.length === 0) return []
  const offered = candidates.map((candidate) => ({ product_id: candidate.product_id, slot_ids: candidate.slot_ids }))
  const rows = await sql<(Omit<ProductForScoring, 'slot_ids' | 'sizes' | 'colours'> & { colours: string[] | null })[]>`
    with offered as (
      select * from jsonb_to_recordset(${sql.json(offered)}) as o(product_id bigint, slot_ids bigint[])
    )
    select p.id::int as product_id, p.content_hash, r.name as retailer, p.title, p.vendor, p.product_type,
           p.tags, p.body_html, p.images,
           (select array_agg(distinct v.option_colour) from product_variants v
             where v.product_id = p.id and v.available and v.option_colour is not null) as colours
    from offered o
    join products p on p.id = o.product_id
    join retailers r on r.id = p.retailer_id
    where not ${onlyUnscored} or not exists (
      select 1 from product_scores s
      where s.product_id = p.id and s.content_hash = p.content_hash
        and s.scored_at >= (
          select max(greatest(b.created_at, coalesce(b.edited_at, b.created_at)))
          from blueprint_slots b where b.id = any (o.slot_ids)
        )
    )
  `
  const byId = new Map(rows.map((row) => [row.product_id, row]))
  return candidates.flatMap((candidate) => {
    const row = byId.get(candidate.product_id)
    return row ? [{ ...row, colours: row.colours ?? [], slot_ids: candidate.slot_ids, sizes: candidate.sizes }] : []
  })
}

function firstRank(slotIds: number[], rank: Map<number, number>): number {
  return Math.min(...slotIds.map((id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER))
}

export async function scoreAll(
  sql: Sql,
  runId: number,
  context: string,
  products: ProductForScoring[],
  options: {
    maxUsd: number
    concurrency: number
    log: Log
    /** The call itself; tests pass a fake. */
    scoreOne?: typeof scoreProduct
    /** Where a verdict is kept; tests pass a fake. */
    save?: typeof saveScore
  },
): Promise<ScoreStats> {
  return judgeAll(sql, runId, context, products, {
    ...options,
    event: 'score',
    judgeOne: options.scoreOne ?? scoreProduct,
    save: options.save ?? saveScore,
  })
}

/**
 * Asks Claude about each product in order, a few at a time, until the list or
 * the money runs out: the slot scorer's loop, and the statement judge's. The
 * first call goes alone, so it writes the cached context the rest read. A run
 * of API errors in a row stops it, and the rest wait for the next run.
 */
export async function judgeAll<P extends { product_id: number }, O>(
  sql: Sql,
  runId: number,
  context: string,
  products: P[],
  options: {
    maxUsd: number
    concurrency: number
    log: Log
    /** The prefix of the log events: "score", "statements". */
    event: string
    judgeOne: (context: string, product: P) => Promise<{ output: O; usage: Usage; servedBy: string }>
    save: (sql: Sql, runId: number, product: P, output: O, usage: Usage, servedBy: string) => Promise<void>
  },
): Promise<ScoreStats> {
  const { judgeOne: scoreOne, save, event } = options
  const started = Date.now()
  const stats: ScoreStats = {
    needed: products.length,
    scored: 0,
    failed: 0,
    skipped_for_budget: 0,
    skipped_for_errors: 0,
    stopped: null,
    failures: {},
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    usd: 0,
    seconds: 0,
  }
  const queue = [...products]
  // A run of API errors in a row means the API itself is refusing (an empty
  // credit balance, an outage), not that one product is odd: stop asking.
  let apiErrorsInARow = 0

  const add = (usage: Usage) => {
    stats.tokens.input += usage.input
    stats.tokens.output += usage.output
    stats.tokens.cacheWrite += usage.cacheWrite
    stats.tokens.cacheRead += usage.cacheRead
    stats.usd = costUsd(stats.tokens)
  }

  const one = async (product: P) => {
    try {
      const { output, usage, servedBy } = await scoreOne(context, product)
      add(usage)
      await save(sql, runId, product, output, usage, servedBy)
      stats.scored += 1
      apiErrorsInARow = 0
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error
      if (error instanceof ScoreUsageError) add(error.usage)
      const reason =
        error instanceof ScoreError
          ? error.message
          : error instanceof Anthropic.APIError
            ? `api ${error.status ?? 'error'}`
            : 'error'
      stats.failed += 1
      stats.failures[reason] = (stats.failures[reason] ?? 0) + 1
      apiErrorsInARow = error instanceof Anthropic.APIError ? apiErrorsInARow + 1 : 0
      if (apiErrorsInARow >= MAX_API_ERRORS_IN_A_ROW && stats.stopped === null) {
        stats.stopped = `${MAX_API_ERRORS_IN_A_ROW} API errors in a row; the last: ${(error as Error).message.slice(0, 200)}`
        stats.skipped_for_errors = queue.length
        queue.length = 0
        options.log({ event: `${event}.stopped`, reason: stats.stopped, left: stats.skipped_for_errors })
      }
      options.log({ event: `${event}.failed`, product_id: product.product_id, reason, message: (error as Error).message.slice(0, 200) })
    }
    const done = stats.scored + stats.failed
    if (done % 25 === 0) {
      options.log({ event: `${event}.progress`, done, of: stats.needed, usd: Number(stats.usd.toFixed(4)) })
    }
  }

  // The first call writes the cache; the rest read it. A budget of nothing
  // means no calls at all.
  if (options.maxUsd <= 0) {
    stats.skipped_for_budget = queue.length
    queue.length = 0
  }
  const first = queue.shift()
  if (first) await one(first)

  const worker = async () => {
    for (;;) {
      if (stats.usd >= options.maxUsd) {
        // Every worker comes here once the cap is reached; only the first finds
        // anything left, so add rather than set, or the last word is zero.
        stats.skipped_for_budget += queue.length
        queue.length = 0
        return
      }
      const product = queue.shift()
      if (!product) return
      await one(product)
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, worker))

  stats.seconds = Math.round((Date.now() - started) / 1000)
  stats.usd = Number(stats.usd.toFixed(4))
  return stats
}

async function saveScore(
  sql: Sql,
  runId: number,
  product: ProductForScoring,
  output: ScoreOutput,
  usage: Usage,
  servedBy: string,
): Promise<void> {
  const row = {
    product_id: product.product_id,
    content_hash: product.content_hash,
    slot_id: output.slot_id,
    score: output.score,
    colour_verdict: output.colour_verdict,
    fit_verdict: output.fit_verdict,
    fabric_notes: output.fabric_notes,
    why: output.why,
    alternatives: sql.json(output.alternatives),
    model: MODELS.scoring,
    served_by: servedBy,
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_tokens: usage.cacheRead,
    cache_write_tokens: usage.cacheWrite,
    usd: costUsd(usage),
    run_id: runId,
    colour_option: output.colour,
    scored_at: new Date(),
  }
  // A re-score of the same version (its slots changed) replaces the old verdict.
  await sql`
    insert into product_scores ${sql(row)}
    on conflict (product_id, content_hash) do update set
      slot_id = excluded.slot_id, score = excluded.score, colour_verdict = excluded.colour_verdict,
      fit_verdict = excluded.fit_verdict, fabric_notes = excluded.fabric_notes, why = excluded.why,
      alternatives = excluded.alternatives, model = excluded.model, served_by = excluded.served_by,
      input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens, cache_write_tokens = excluded.cache_write_tokens,
      usd = excluded.usd, run_id = excluded.run_id, colour_option = excluded.colour_option,
      scored_at = excluded.scored_at
  `
}

export function plainText(html: string | null): string {
  if (!html) return ''
  return html
    .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
