import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { listSlots, type Slot } from './blueprint.ts'
import { callUsd, claude, MODELS } from './claude.ts'
import { db, type Sql } from './db.ts'
import { findPrice, type Price } from './feed.ts'
import { findCandidates, type Rates } from './finder/filter.ts'
import { loadRates } from './finder/fx.ts'
import { forScoring, plainText, type ProductForScoring } from './finder/score.ts'
import type { ProductImage } from './finder/shopify.ts'
import { ceilings } from './finder/statements.ts'
import { BOTTOMS, FOOTWEAR, isWhole, LAYER_ORDER, TOPS } from './look-rules.ts'
import {
  dressable,
  getLooks,
  GYM_FIT_RULES,
  gymForPrompt,
  gymReadiness,
  matchingLooks,
  OCCASIONS,
  offerLook,
  OUTFIT_STYLING,
  pieceForPrompt,
  readHistory,
  readiness,
  wellingtonToday,
  type History,
  type Look,
  type Occasion,
} from './looks.ts'
import { describedKey, outfitKey } from './outfit-key.ts'
import { BRIEF_MAX, OUTFIT_SOURCES, SOURCE_LABELS, usesShops, usesWardrobe, type OutfitSource } from './outfit-values.ts'
import { listPieces, type Piece } from './pieces.ts'
import { getProfile, type Profile } from './profile.ts'
import { listRetailers, STOCK_PLATFORMS } from './retailers.ts'
import { GARMENT_GUIDE, rankForRequest, searchTarget, type SearchTarget } from './search.ts'
import { finalText, generate, GenerationError, plainDashes, type GenerationMeta } from './structured.ts'
import { getGuide, profileBrief, type Guide } from './style-guide.ts'
import { tryOnsByKey, type OnMe } from './try-on.ts'
import { limitForPrompt, WARMTH_RULES, warmthLimit } from './warmth.ts'
import { forEveryday, forGym, GARMENT_TYPES, normaliseHex, type GarmentType } from './wardrobe-values.ts'

/*
 * An outfit from scratch (migration 0023), asked for by Malin on 2026-11-10.
 * On the Wardrobe tab's Outfit page he says what it is for and what it is
 * made from, and one outfit comes back:
 *
 *   wardrobe  Opus dresses him from his pieces alone, for the brief. The
 *             outfit is a look like any other, in a set of its own kind.
 *   shops     nothing he owns. Sonnet reads the brief into the garments to
 *             look for (plan), the nightly filter finds each in his size over
 *             what the last run read (pool), and Opus puts the outfit
 *             together from the closest of each.
 *   both      the same, with his pieces beside the pool: Opus wears what he
 *             owns and buys only what he lacks or what clearly does better.
 *   anywhere  tied to no shop and to nothing he owns (migration 0024): Opus
 *             describes the ideal garments in words, each with its colour
 *             from his palette and the words to search the shops with, and
 *             the ask makes a picture of him in them (try-on.ts), since
 *             words and swatches alone show him nothing.
 *
 * Claude is sent words only, never a photo. Code holds the answer to what an
 * outfit must be (tidyOutfit): only pieces he has and products from the pool,
 * a whole outfit by look-rules, nothing from a source he did not ask for. An
 * outfit that turns out to be all his own pieces is saved as a look, whatever
 * he asked for.
 */

export { BRIEF_MAX, OUTFIT_SOURCES, SOURCE_LABELS, type OutfitSource }

/** The most garments one plan may ask the shops for. */
export const MAX_WANTS = 8
/** Of each garment asked for, the closest to the plan's words that go to Opus. */
export const POOL_CLOSEST = 10
/** And, beyond those, the ones he saved or Claude rated well for him before. */
export const POOL_LIKED = 4
/** A product Claude scored this or more before, for a slot or as a statement piece, counts as liked. */
const LIKED_SCORE = 70
/** An outfit still in the making after this long died with its server. */
const STALE_MINUTES = 10

export class OutfitError extends Error {}

// ---------------------------------------------------------------------------
// 1. The plan: what to look for in the shops
// ---------------------------------------------------------------------------

export const WantSchema = z.object({
  garment_type: z.enum(GARMENT_TYPES).describe('The garment, from the fixed list.'),
  words: z
    .array(z.string())
    .describe('One to four lowercase words a matching listing would use, beyond its colour: "oxford", "merino", "derby", "pleated". Empty when the garment type says it all.'),
  colours: z
    .array(z.string())
    .describe('One to three plain colour words a shop would use, lowercase, that suit him and the outfit: "navy", "olive", "rust", "ecru". Empty only when any colour would do.'),
  max_nzd: z.number().nullable().describe('The most to pay for it in NZ dollars, only when his brief gives a price. Null otherwise.'),
  role: z.string().describe('What it does in the outfit, a few words: "the jacket, dark and matte", "a tie in his metal\'s warmth".'),
})

export type Want = z.infer<typeof WantSchema>

export const PlanSchema = z.object({
  understood: z.boolean().describe('True when the brief is something to dress for, or empty.'),
  problem: z.string().nullable().describe('When not understood, one short sentence to him saying why and what to type instead. Null otherwise.'),
  wants: z.array(WantSchema).describe(`The garments to look for in the shops, at most ${MAX_WANTS}.`),
})

export type Plan = z.infer<typeof PlanSchema>

export const PLAN_SYSTEM_PROMPT = `You are an experienced menswear stylist working for one client, Malin, in Wellington, New Zealand. He asked his private app for one outfit and said what it is for. You do not choose the outfit yet: you say which garments to look for in the shops. The app then finds each in his size among New Zealand menswear shops and a few abroad that ship there, and a stylist puts the outfit together from the closest of each.

You have his brief, what the outfit may be made from, his profile, his style guide, the month's usual weather and, when the outfit may use his own clothes, the pieces he owns.

${GARMENT_GUIDE}

When it is made from the shops alone, name every garment of one whole outfit for the brief: at least one top, one of trousers, jeans or shorts, and one of shoes, boots or sneakers; an outer layer when the weather or the occasion asks for one; tailoring when the occasion does; a belt or an accessory only when the outfit needs it, such as a tie for a wedding. Four to ${MAX_WANTS} garments. Where two different garments would answer the same place equally well (shoes or boots), you may name both and the stylist chooses.

When it is made from both, start from what he owns. Name only what the outfit needs that he does not own, or what would clearly do better for this brief than anything he owns: at most four garments, and none at all when his wardrobe answers the brief whole.

Colour is how the app narrows the shops, so give each garment plain colour words a shop would use, taken from his palette: his best colours and neutrals, never one he should avoid. Think of the outfit as one colour story and give each garment its part in it. Keep to the fits his guide gives. Set the level of dress by the brief; a deliberate mix of dressy and relaxed is open when it suits.

An empty brief means an outfit for an ordinary day this week. It is not understood only when it is not about getting dressed at all; then say why in one short sentence to him, in the second person. Plain hyphens only.`

export type PlanInput = {
  brief: string
  source: 'shops' | 'both'
  profile: Profile
  guide: Guide
  pieces: Piece[]
  history: Pick<History, 'worn' | 'offered'>
  now?: Date
}

export function buildPlanMessage(input: PlanInput): string {
  const { date, weather } = wellingtonToday(input.now)
  const body = {
    today: date,
    usual_weather: weather,
    made_from: input.source === 'shops' ? 'the shops alone' : 'both his wardrobe and the shops',
    profile: profileBrief(input.profile),
    style_guide: guideForPrompt(input.guide),
    ...(input.source === 'both'
      ? { his_pieces: dressable(input.pieces).filter(forEveryday).map((piece) => pieceForPrompt(piece, input.guide, input.history)) }
      : {}),
  }
  return `${JSON.stringify(body, null, 2)}\n\n${briefLine(input.brief)} Say what to look for in the shops.`
}

function briefLine(brief: string): string {
  return brief ? `His brief: ${JSON.stringify(brief)}.` : 'He gave no brief: an outfit for an ordinary day this week.'
}

function guideForPrompt(guide: Guide) {
  return {
    palette: guide.palette,
    silhouette: guide.silhouette,
    shoes: guide.shoes,
    accessories: guide.accessories,
    fit_vocabulary: guide.fit_vocabulary,
  }
}

/** Sonnet plans what to look for. Returns what it cost even when the plan is unusable. */
export async function planOutfit(input: PlanInput): Promise<{ plan: Plan | null; usd: number }> {
  // Without `parse`, the SDK passes the schema through and leaves the text alone.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parse: _parse, ...format } = zodOutputFormat(PlanSchema)
  const response = await claude().beta.messages.create(
    {
      model: MODELS.outfitPlan,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      system: PLAN_SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: buildPlanMessage(input) }],
      output_config: { effort: 'medium' as const, format },
    },
    { maxRetries: 3 },
  )
  const usd = callUsd(MODELS.outfitPlan, response.usage)
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return { plan: null, usd }
  let json: unknown
  try {
    json = JSON.parse(finalText(response.content))
  } catch {
    return { plan: null, usd }
  }
  const parsed = PlanSchema.safeParse(json)
  return { plan: parsed.success ? (plainDashes(parsed.data) as Plan) : null, usd }
}

// ---------------------------------------------------------------------------
// 2. The pool: the closest of each garment, in his size
// ---------------------------------------------------------------------------

/**
 * One want as the filter's target: the search's own reading of a request,
 * numbered from 1 in the plan's order, under the most he would pay for one of
 * its kind unless the brief gave a price.
 */
export function wantTarget(
  want: Want,
  index: number,
  sizes: Profile['sizes'],
  guideFits: (garment: GarmentType) => string[],
  ceiling: Partial<Record<GarmentType, number>>,
): SearchTarget {
  const target = searchTarget(
    {
      understood: true,
      garment_type: want.garment_type,
      words: want.words,
      colours: want.colours,
      min_nzd: null,
      max_nzd: want.max_nzd,
      fit: null,
      fabrics: [],
      summary: want.role,
      problem: null,
    },
    sizes,
    guideFits,
  )
  return { ...target, slot_id: index + 1, max_cents: target.max_cents ?? ceiling[want.garment_type] ?? null }
}

export type Liked = { rated: number | null; saved: boolean }

/**
 * Of one want's products, already closest to its words first, the ones Opus
 * is shown: the closest few, then the best of the rest that he saved or that
 * Claude rated well for him before, saved first.
 */
export function pickForWant<T extends { product_id: number }>(ranked: T[], liked: Map<number, Liked>): T[] {
  const closest = ranked.slice(0, POOL_CLOSEST)
  const worth = (product: T) => {
    const known = liked.get(product.product_id)
    if (!known) return 0
    return (known.saved ? 1000 : 0) + (known.rated !== null && known.rated >= LIKED_SCORE ? known.rated : 0)
  }
  const rest = ranked
    .slice(POOL_CLOSEST)
    .map((product, index) => ({ product, index, worth: worth(product) }))
    .filter((entry) => entry.worth > 0)
    .sort((a, b) => b.worth - a.worth || a.index - b.index)
    .slice(0, POOL_LIKED)
    .map((entry) => entry.product)
  return [...closest, ...rest]
}

export type PoolItem = {
  product_id: number
  /** Which want it answers, counted from 0 in the plan's order. */
  want: number
  garment_type: GarmentType
  title: string
  vendor: string | null
  retailer: string
  colours: string[]
  about: string
  /** In the store's currency, in his size. */
  price_cents: number
  compare_at_cents: number | null
  nzd_cents: number
  sizes: string[]
  size_known: boolean
  rated: number | null
  saved: boolean
}

export type Pool = { items: PoolItem[]; matched: number; fx: { rates: Rates; source: string; date: string | null } }

/** The shops' answer to the plan: for each want, the closest in his size from the stores he has on. */
export async function findPool(
  sql: Sql,
  wants: Want[],
  input: { profile: Pick<Profile, 'sizes' | 'budget'>; guide: Pick<Guide, 'fit_vocabulary'>; slots: Pick<Slot, 'garment_type' | 'budget_max_cents'>[] },
): Promise<Pool> {
  const retailers = (await listRetailers(sql)).filter((retailer) => retailer.enabled)
  const fx = await loadRates(sql, retailers.map((retailer) => retailer.currency))
  if (wants.length === 0) return { items: [], matched: 0, fx }
  const ceiling = ceilings(input.profile.budget, input.slots, GARMENT_TYPES)
  const guideFits = (garment: GarmentType) => input.guide.fit_vocabulary.find((entry) => entry.garment === garment)?.fits ?? []
  const targets = wants.map((want, index) => wantTarget(want, index, input.profile.sizes, guideFits, ceiling))

  const { candidates } = await findCandidates(sql, targets, fx.rates)
  if (candidates.length === 0) return { items: [], matched: 0, fx }
  const ids = candidates.map((candidate) => candidate.product_id)
  const [products, facts] = await Promise.all([
    forScoring(sql, candidates, { onlyUnscored: false }),
    sql<{ product_id: number; currency: string; rated: number | null; saved: boolean }[]>`
      with latest_action as (
        select distinct on (product_id) product_id, action
        from feed_actions where product_id = any (${ids}::bigint[])
        order by product_id, created_at desc, id desc
      )
      select p.id::int as product_id, r.currency,
             (select max(s.score)::int from (
                select score from product_scores where product_id = p.id
                union all
                select score from statement_scores where product_id = p.id
              ) s) as rated,
             coalesce(a.action = 'saved', false) as saved
      from products p
      join retailers r on r.id = p.retailer_id
      left join latest_action a on a.product_id = p.id
      where p.id = any (${ids}::bigint[])
    `,
  ])
  const byId = new Map(candidates.map((candidate) => [candidate.product_id, candidate]))
  const fact = new Map(facts.map((row) => [row.product_id, row]))
  const liked = new Map<number, Liked>(facts.map((row) => [row.product_id, { rated: row.rated, saved: row.saved }]))

  const items: PoolItem[] = []
  const taken = new Set<number>()
  for (const [index, target] of targets.entries()) {
    const mine = products.filter((product) => product.slot_ids.includes(target.slot_id) && !taken.has(product.product_id))
    for (const product of pickForWant(rankForRequest(mine, target), liked)) {
      const candidate = byId.get(product.product_id)!
      const known = fact.get(product.product_id)
      if (!known) continue
      taken.add(product.product_id)
      items.push(poolItem(product, index, target.garment_type, candidate, known, fx.rates))
    }
  }
  return { items, matched: candidates.length, fx }
}

function poolItem(
  product: ProductForScoring,
  want: number,
  garment: GarmentType,
  candidate: { price_cents: number; compare_at_cents: number | null; sizes: string[]; size_known: boolean },
  known: { currency: string; rated: number | null; saved: boolean },
  rates: Rates,
): PoolItem {
  return {
    product_id: product.product_id,
    want,
    garment_type: garment,
    title: product.title,
    vendor: product.vendor,
    retailer: product.retailer,
    colours: product.colours,
    about: plainText(product.body_html).replace(/\s+/g, ' ').slice(0, 240),
    price_cents: candidate.price_cents,
    compare_at_cents: candidate.compare_at_cents,
    nzd_cents: Math.round(candidate.price_cents * (rates[known.currency] ?? 1)),
    sizes: candidate.sizes,
    size_known: candidate.size_known,
    rated: known.rated,
    saved: known.saved,
  }
}

/** Whether the pool alone can dress him: a top, trousers and shoes among it. */
export function coversOutfit(pool: Pick<PoolItem, 'garment_type'>[]): boolean {
  const has = (types: GarmentType[]) => pool.some((item) => types.includes(item.garment_type))
  return has(TOPS) && has(BOTTOMS) && has(FOOTWEAR)
}

// ---------------------------------------------------------------------------
// 3. The outfit
// ---------------------------------------------------------------------------

export const OutfitDraftSchema = z.object({
  title: z.string().describe('A name for the outfit, two to five words, plain, no puns: "Ink suit, rust tie".'),
  occasion: z.enum(OCCASIONS).describe('The nearest of the fixed occasions to what he asked for.'),
  weather: z.string().describe('The day it is dressed for, a few words: "mild and still", "a cool evening".'),
  piece_ids: z
    .array(z.number().int())
    .describe('Ids of the pieces of his it wears, from his_pieces only. Empty when it is made from the shops alone.'),
  shop_items: z
    .array(
      z.object({
        id: z.number().int().describe('The id of a product from the shop list.'),
        why: z.string().describe('Why this one, a few words to him: "the deepest of the navies, matte wool".'),
      }),
    )
    .describe('The products it wears, from the shop list only. Empty when it is made from his wardrobe alone.'),
  ideas: z
    .array(
      z.object({
        garment_type: z.enum(GARMENT_TYPES).describe('The garment, from the fixed list.'),
        name: z.string().describe('What it is, as a shop would title it, three to six words: "Ink hopsack unstructured blazer".'),
        colour_name: z.string().describe('Its colour, by the name his palette gives it where it is one of his.'),
        colour_hex: z.string().describe('That colour as a hex: the palette\'s own hex when it is one of his colours.'),
        fabric: z.string().nullable().describe('The cloth, a few words: "wool hopsack", "heavy cotton twill". Null when it does not matter.'),
        fit: z.string().nullable().describe('The cut, in his guide\'s words: "regular, natural shoulder". Null when it does not matter.'),
        why: z.string().describe('What it does in the outfit, a few words to him.'),
        search: z.string().describe('What to type to find it in a shop, under 60 characters: "navy hopsack blazer".'),
      }),
    )
    .describe('Garments described in words, only when the outfit is made from anything. Empty otherwise.'),
  why: z
    .string()
    .describe('Two or three sentences to him: how it answers what he asked for, the colour story in his palette, and the proportion or fit move from his guide.'),
  styling: z.string().nullable().describe('One short instruction for wearing it: "collar open, one cuff on the trousers". Null when there is nothing to add.'),
})

export type OutfitDraft = z.infer<typeof OutfitDraftSchema>

export const ComposeSchema = z.object({
  outfits: z
    .array(OutfitDraftSchema)
    .describe('Two outfits for the brief, the best first, that share as little as they can. He is shown the first; the second stands in only if the first cannot be made.'),
})

export const OUTFIT_SYSTEM_PROMPT = `You are an experienced menswear stylist putting one outfit together for one client, Malin, in Wellington, New Zealand. He asked his private app for an outfit and said what it is for, and what it may be made from: his wardrobe, the shops, both, or anything. You have his brief, his confirmed profile (colouring, proportions, sizes, his week), the style guide written for him, the month's usual weather, and whichever of these the outfit may use: the pieces he owns, and a list of products from the shops, each in stock in his size.

The outfit is one complete outfit he could put on: at least one top, exactly one pair of trousers, jeans or shorts, exactly one pair of shoes, at most one coat or jacket and one tailored jacket, an outer layer when the weather asks for it, and at most three things carried or worn as accessories, each only when it adds something. Use only pieces from his_pieces and products from shop, by id, each at most once; never invent a garment. From his wardrobe alone, shop_items is empty. From the shops alone, piece_ids is empty: he wants to see what a whole new outfit would be.

From anything, the outfit is tied to no shop and to nothing he owns: piece_ids and shop_items are empty, and every garment is one you describe in ideas, the ideal one for him and the brief. Describe real garments he could go and find, each specific enough to search a shop for: what it is, its colour from his palette with the palette's hex, its cloth and its cut in his guide's words. In every other case ideas is empty.

From both, wear what he owns wherever one of his pieces answers the brief as well as anything in the shops, and buy only what he lacks or what clearly lifts the outfit. Every product is money: an outfit that buys one right thing is better than one that buys four.

The shop list is what the shops have for a plan made a moment ago: each product says the place in the outfit it was found for (for), its colours in stock, its price in NZ dollars, and sometimes rated (how well it was judged to suit him before, out of 100) or saved (he saved it to his wishlist). Lean on saved and well rated products where they fit. Read a product's cloth, cut and level of dress from its name and description. When his brief gives a budget, keep the products' total inside it.

The brief decides the level of dress and the occasion; his week does not. ${OUTFIT_STYLING}

Dress him for Wellington in the month you are given unless his brief names another place, season or weather. You have the month's usual weather and warmth_limit, read from its usual high: keep within it for an ordinary day, and go past it only when the brief asks (a formal event takes a jacket whatever the day). ${WARMTH_RULES} A product gives no warmth: read it from its garment and cloth.

${GYM_FIT_RULES} Make a gym fit only when his brief is about training, and only from his own kit.

Colour is the point. Work from his palette and say in the why which of his colours carry the outfit and why they sit together. Respect the proportion and fit rules in his guide and name the one the outfit uses. Respect his no-gos absolutely.

Give two outfits, the best first. The second is a different answer to the same brief, sharing as little with the first as his pieces and the shops allow.

Write to him in the second person, plainly, without praise or sales talk. Plain hyphens only.`

export type ComposeInput = {
  brief: string
  source: OutfitSource
  profile: Profile
  guide: Guide
  pieces: Piece[]
  history: Pick<History, 'worn' | 'offered'>
  pool: PoolItem[]
  wants: Want[]
  now?: Date
}

export function buildOutfitMessages(input: ComposeInput): Anthropic.Beta.BetaMessageParam[] {
  const { date, weather, high } = wellingtonToday(input.now)
  const mine = usesWardrobe(input.source)
  const shops = usesShops(input.source)
  const body = {
    today: date,
    usual_weather: weather,
    warmth_limit: limitForPrompt(warmthLimit(high), `the month's usual high, ${high}°`),
    made_from: MADE_FROM[input.source],
    profile: profileBrief(input.profile),
    ...(mine ? { gym: gymForPrompt(input.profile, input.pieces) } : {}),
    style_guide: guideForPrompt(input.guide),
    ...(mine ? { his_pieces: dressable(input.pieces).map((piece) => pieceForPrompt(piece, input.guide, input.history)) } : {}),
    ...(shops
      ? {
          shop: input.pool.map((item) => ({
            id: item.product_id,
            name: item.title,
            brand: item.vendor,
            shop: item.retailer,
            garment: item.garment_type,
            for: input.wants[item.want]?.role ?? null,
            colours: item.colours,
            price_nzd: Math.round(item.nzd_cents / 100),
            about: item.about || null,
            ...(item.rated !== null ? { rated: item.rated } : {}),
            ...(item.saved ? { saved: true } : {}),
          })),
        }
      : {}),
  }
  return [{ role: 'user', content: `${JSON.stringify(body, null, 2)}\n\n${briefLine(input.brief)} Put the outfit together.` }]
}

const MADE_FROM: Record<OutfitSource, string> = {
  wardrobe: 'his wardrobe alone',
  shops: 'the shops alone',
  both: 'both his wardrobe and the shops',
  anywhere: 'anything: garments you describe, tied to no shop and to nothing he owns',
}

export type Composed = { outfits: OutfitDraft[]; meta: GenerationMeta; usd: number }

export async function composeOutfit(input: ComposeInput): Promise<Composed> {
  const { data, meta } = await generate({
    schema: ComposeSchema,
    system: OUTFIT_SYSTEM_PROMPT,
    messages: buildOutfitMessages(input),
    maxTokens: 16000,
    what: 'outfit',
    model: MODELS.outfit,
  })
  return { outfits: data.outfits, meta, usd: callUsd(MODELS.outfit, { input_tokens: meta.input_tokens, output_tokens: meta.output_tokens }) }
}

/** A garment described in words, for an outfit made from anything. */
export type Idea = {
  garment_type: GarmentType
  name: string
  colour_name: string
  colour_hex: string | null
  fabric: string | null
  fit: string | null
  why: string
  search: string
}

/** One thing an outfit is made of: a piece of his, a product, or a garment described. */
export type OutfitItem = { piece_id: number | null; product_id: number | null; why: string | null; idea: Idea | null }

export type TidyOutfit = Omit<OutfitDraft, 'piece_ids' | 'shop_items' | 'ideas'> & { items: OutfitItem[] }

/**
 * Holds Claude to what an outfit must be. Pieces he does not have, has set
 * aside or does not wear for its occasion, products that were not in the
 * pool, repeats, and anything from a source he did not ask for (a garment
 * only described among them, unless he asked for anything) are dropped
 * first; what is left must be a whole outfit by look-rules, or there is no
 * outfit. Its items are put in layer order, his own piece before a product of
 * the same garment.
 */
export function tidyOutfit(
  draft: OutfitDraft,
  source: OutfitSource,
  pieces: Pick<Piece, 'id' | 'garment_type' | 'set_aside_at' | 'worn_for'>[],
  pool: Pick<PoolItem, 'product_id' | 'garment_type'>[],
): TidyOutfit | null {
  const mine = new Map(dressable(pieces).map((piece) => [piece.id, piece]))
  const sold = new Map(pool.map((item) => [item.product_id, item]))
  const wornFor = draft.occasion === 'gym' ? forGym : forEveryday

  const pieceIds = usesWardrobe(source) ? [...new Set(draft.piece_ids)].filter((id) => mine.has(id) && wornFor(mine.get(id)!)) : []
  const products = usesShops(source)
    ? draft.shop_items.filter((item, index, all) => sold.has(item.id) && all.findIndex((other) => other.id === item.id) === index)
    : []
  const ideas = source === 'anywhere' ? draft.ideas.filter((idea) => idea.name.trim() !== '') : []

  const entries: { garment: GarmentType; item: OutfitItem }[] = [
    ...pieceIds.map((id) => ({ garment: mine.get(id)!.garment_type, item: { piece_id: id, product_id: null, why: null, idea: null } })),
    ...products.map((item) => ({
      garment: sold.get(item.id)!.garment_type,
      item: { piece_id: null, product_id: item.id, why: item.why.trim() || null, idea: null },
    })),
    ...ideas.map((idea) => ({
      garment: idea.garment_type,
      item: {
        piece_id: null,
        product_id: null,
        why: null,
        idea: {
          garment_type: idea.garment_type,
          name: idea.name.trim(),
          colour_name: idea.colour_name.trim(),
          colour_hex: normaliseHex(idea.colour_hex),
          fabric: idea.fabric?.trim() || null,
          fit: idea.fit?.trim() || null,
          why: idea.why.trim(),
          search: idea.search.trim().slice(0, 200),
        },
      },
    })),
  ]
  if (!isWhole(entries.map((entry) => entry.garment))) return null
  // A stable sort, so his own piece stays ahead of a product of the same garment.
  entries.sort((a, b) => LAYER_ORDER.indexOf(a.garment) - LAYER_ORDER.indexOf(b.garment))
  return {
    title: draft.title.trim(),
    occasion: draft.occasion,
    weather: draft.weather,
    why: draft.why,
    styling: draft.styling,
    items: entries.map((entry) => entry.item),
  }
}

// ---------------------------------------------------------------------------
// Starting and running one
// ---------------------------------------------------------------------------

export type OutfitStarted = { ok: true; id: number } | { ok: false; message: string }

async function sweepStale(sql: Sql): Promise<void> {
  await sql`
    update outfits set status = 'failed', finished_at = now(), error = 'It stopped part way. Try again.'
    where status = 'making' and started_at < now() - make_interval(mins => ${STALE_MINUTES})
  `
}

/** Records an ask, or says why it cannot be made. The work is done by runOutfit, after the response. */
export async function startOutfit(input: { brief: string; source: OutfitSource }, sql: Sql = db()): Promise<OutfitStarted> {
  const brief = input.brief.trim().replace(/\s+/g, ' ')
  if (brief.length > BRIEF_MAX) return { ok: false, message: `Keep it under ${BRIEF_MAX} characters.` }
  const [guide, pieces] = await Promise.all([getGuide(), listPieces(sql)])
  if (!guide) return { ok: false, message: 'An outfit is put together against your style guide. Draft it on the Blueprint tab first.' }
  if (input.source === 'wardrobe') {
    const ready = readiness(pieces)
    if (!ready.ready && !gymReadiness(pieces).ready) return { ok: false, message: `To dress you from your wardrobe, add ${ready.missing.join(', ')} first.` }
  } else if (usesShops(input.source)) {
    const [read] = await sql<{ id: number }[]>`
      select p.id::int as id from products p join retailers r on r.id = p.retailer_id and r.enabled
      where p.removed_at is null and p.menswear limit 1
    `
    if (!read) return { ok: false, message: 'The finder has not read the shops yet. Run it from You, Finder first.' }
  }
  await sweepStale(sql)
  try {
    const [row] = await sql<{ id: number }[]>`
      insert into outfits ${sql({ brief, source: input.source, stage: usesShops(input.source) ? 'planning' : 'composing' })}
      returning id::int as id
    `
    return { ok: true, id: row!.id }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, message: 'Another outfit is still being made. One at a time.' }
    throw error
  }
}

export type OutfitStats = {
  plan_usd?: number
  compose_usd?: number
  wants?: Want[]
  matched?: number
  pool?: number
  proposed?: number
  seconds?: number
  fx?: Pool['fx']
}

type RunOptions = {
  sql?: Sql
  now?: Date
  /** Tests pass fakes for the two Claude calls. */
  plan?: typeof planOutfit
  compose?: typeof composeOutfit
}

/** Runs a recorded ask to the end. Never throws: whatever goes wrong ends as a failed row with words for the page. */
export async function runOutfit(id: number, options: RunOptions = {}): Promise<'ready' | 'failed'> {
  const sql = options.sql ?? db()
  const started = Date.now()
  const [ask] = await sql<{ brief: string; source: OutfitSource }[]>`
    select brief, source from outfits where id = ${id} and status = 'making'
  `
  if (!ask) return 'failed'
  const stats: OutfitStats = {}
  let spent = 0
  const stage = (name: 'looking' | 'composing') =>
    sql`update outfits set stage = ${name}, usd = ${spent}, stats = ${sql.json(stats as never)} where id = ${id}`

  try {
    const [profile, guide, pieces, history, slots] = await Promise.all([getProfile(), getGuide(), listPieces(sql), readHistory(sql), listSlots()])
    if (!guide) throw new OutfitError('An outfit is put together against your style guide. Draft it first.')
    const { source, brief } = ask
    let wants: Want[] = []
    let pool: PoolItem[] = []

    if (source === 'shops' || source === 'both') {
      const { plan, usd } = await (options.plan ?? planOutfit)({ brief, source, profile, guide, pieces, history, now: options.now })
      spent += usd
      stats.plan_usd = Number(usd.toFixed(6))
      if (!plan) throw new OutfitError('Claude could not read that. Try putting it another way.')
      if (!plan.understood) throw new OutfitError(plan.problem ?? 'That is not something to dress for. Say what the outfit is for.')
      wants = plan.wants.slice(0, MAX_WANTS)
      stats.wants = wants
      await stage('looking')
      const found = await findPool(sql, wants, { profile, guide, slots })
      pool = found.items
      stats.matched = found.matched
      stats.pool = pool.length
      stats.fx = found.fx
      if (source === 'shops' && !coversOutfit(pool)) {
        throw new OutfitError('The shops do not have a whole outfit for that in your size right now. Try other words, or make it from both.')
      }
      if (source === 'both' && pool.length === 0 && !readiness(pieces).ready) {
        throw new OutfitError('Neither your wardrobe nor the shops could make a whole outfit for that. Try other words.')
      }
      await stage('composing')
    }

    const composed = await (options.compose ?? composeOutfit)({ brief, source, profile, guide, pieces, history, pool, wants, now: options.now })
    spent += composed.usd
    stats.compose_usd = Number(composed.usd.toFixed(6))
    stats.proposed = composed.outfits.length
    const outfit = composed.outfits.map((draft) => tidyOutfit(draft, source, pieces, pool)).find((tidy) => tidy !== null)
    if (!outfit) throw new OutfitError('The outfit Claude made did not hold together. Try again.')

    stats.seconds = Math.round((Date.now() - started) / 1000)
    await saveOutfit(sql, id, outfit, pool, { brief, meta: composed.meta, usd: composed.usd, spent, stats, pieces: pieces.filter((piece) => !piece.set_aside_at).length, now: options.now })
    return 'ready'
  } catch (error) {
    const known = error instanceof OutfitError || error instanceof GenerationError
    if (!known) console.error('outfit: failed', error)
    const message = known
      ? error.message
      : error instanceof Anthropic.APIError
        ? 'Claude did not answer. Try again in a minute.'
        : 'Something went wrong. Try again.'
    stats.seconds = Math.round((Date.now() - started) / 1000)
    await sql`
      update outfits set status = 'failed', error = ${message}, usd = ${spent}, stats = ${sql.json(stats as never)}, finished_at = now()
      where id = ${id}
    `
    return 'failed'
  }
}

/**
 * The outfit on its row, with what it is made of. One made only of his
 * pieces is offered as a look in a set of kind 'ask' (the look already made
 * with those pieces, when there is one), so it is saved, worn, changed and
 * pictured as a look.
 */
async function saveOutfit(
  sql: Sql,
  id: number,
  outfit: TidyOutfit,
  pool: PoolItem[],
  call: { brief: string; meta: GenerationMeta; usd: number; spent: number; stats: OutfitStats; pieces: number; now?: Date },
): Promise<void> {
  const sold = new Map(pool.map((item) => [item.product_id, item]))
  const { date, weather } = wellingtonToday(call.now)
  await sql.begin(async (tx) => {
    let setId: number | null = null
    if (outfit.items.every((item) => item.piece_id !== null)) {
      const [set] = await tx<{ id: number }[]>`
        insert into look_sets ${tx({
          kind: 'ask',
          note: call.brief || null,
          context: tx.json({ date, weather, pieces: call.pieces, for: outfit.occasion === 'gym' ? 'gym' : 'week' }),
          model: call.meta.model,
          served_by: call.meta.served_by,
          input_tokens: call.meta.input_tokens,
          output_tokens: call.meta.output_tokens,
          usd: Number(call.usd.toFixed(6)),
          proposed: call.stats.proposed ?? 1,
        })}
        returning id::int as id
      `
      setId = set!.id
      await offerLook(
        tx,
        setId,
        0,
        {
          title: outfit.title,
          occasion: outfit.occasion,
          weather: outfit.weather,
          why: outfit.why,
          styling: outfit.styling,
          piece_ids: outfit.items.map((item) => item.piece_id!),
        },
        await matchingLooks(tx),
      )
    }
    await tx`
      insert into outfit_items ${tx(
        outfit.items.map((item, position) => {
          const product = item.product_id !== null ? sold.get(item.product_id) : undefined
          return {
            outfit_id: id,
            position,
            piece_id: item.piece_id,
            product_id: item.product_id,
            why: item.why,
            idea: item.idea ? tx.json(item.idea) : null,
            price_cents: product?.price_cents ?? null,
            compare_at_cents: product?.compare_at_cents ?? null,
            sizes: product?.sizes ?? [],
            size_known: product?.size_known ?? false,
          }
        }),
      )}
    `
    await tx`
      update outfits set
        status = 'ready', title = ${outfit.title}, occasion = ${outfit.occasion}, weather = ${outfit.weather},
        why = ${outfit.why}, styling = ${outfit.styling}, set_id = ${setId},
        usd = ${call.spent}, stats = ${tx.json(call.stats as never)}, finished_at = now()
      where id = ${id}
    `
  })
}

// ---------------------------------------------------------------------------
// Reading outfits for the page
// ---------------------------------------------------------------------------

export type OutfitStatus = 'making' | 'ready' | 'failed'
export type OutfitStage = 'planning' | 'looking' | 'composing'

export type OutfitSummary = {
  id: number
  brief: string
  source: OutfitSource
  status: OutfitStatus
  stage: OutfitStage
  error: string | null
  title: string | null
  started_at: Date
  finished_at: Date | null
}

/** A product of an outfit, as its row shows it. */
export type ShopItem = {
  product_id: number
  title: string
  vendor: string | null
  url: string
  image: ProductImage | null
  retailer: string
  why: string | null
  price: Price
  sizes: string[]
  size_known: boolean
  stock_known: boolean
  /** What he has done with it since: saved to the wishlist, or bought. */
  state: 'saved' | 'bought' | null
  /** The shop no longer lists it. */
  gone: boolean
}

export type OutfitPart =
  | { key: string; garment_type: GarmentType; name: string; piece: Piece; product: null; idea: null }
  | { key: string; garment_type: GarmentType; name: string; piece: null; product: ShopItem; idea: null }
  | { key: string; garment_type: GarmentType; name: string; piece: null; product: null; idea: Idea }

export type OutfitView = OutfitSummary & {
  occasion: Occasion | null
  weather: string | null
  why: string | null
  styling: string | null
  usd: number
  parts: OutfitPart[]
  /** The look it is, when it is made only of his pieces and he has not dismissed it. */
  look: Look | null
  /** True when it was a look and he dismissed it. */
  dismissed: boolean
  /** What the products cost together, in NZ cents at the rates it was priced with. */
  to_buy_cents: number
  /** The kept picture of him in exactly these, if one was made. */
  on_me: OnMe | null
  /** Made in the last few seconds: an outfit from anything is about to get its picture. */
  just_made: boolean
}

const STATUS_COLUMNS = (sql: Sql) => sql`
  case when o.status = 'making' and o.started_at < now() - make_interval(mins => ${STALE_MINUTES}) then 'failed' else o.status end as status,
  case when o.status = 'making' and o.started_at < now() - make_interval(mins => ${STALE_MINUTES})
       then 'It stopped part way. Try again.' else o.error end as error
`

/** The asks he made, newest first. */
export async function listOutfits(limit = 9, sql: Sql = db()): Promise<OutfitSummary[]> {
  return sql<OutfitSummary[]>`
    select o.id::int as id, o.brief, o.source, ${STATUS_COLUMNS(sql)}, o.stage, o.title, o.started_at, o.finished_at
    from outfits o order by o.started_at desc, o.id desc limit ${limit}
  `
}

export async function outfitTotals(sql: Sql = db()): Promise<{ count: number; usd: number }> {
  const [row] = await sql<{ count: number; usd: number }[]>`
    select count(*)::int as count, coalesce(sum(usd), 0)::float as usd from outfits
  `
  return row ?? { count: 0, usd: 0 }
}

type OutfitRow = OutfitSummary & {
  occasion: Occasion | null
  weather: string | null
  why: string | null
  styling: string | null
  usd: number
  stats: OutfitStats
  look_id: number | null
  just_made: boolean
}

type ItemRow = {
  position: number
  idea: Idea | null
  piece_id: number | null
  product_id: number | null
  why: string | null
  price_cents: number | null
  compare_at_cents: number | null
  sizes: string[]
  size_known: boolean
  garment_type: GarmentType | null
  title: string | null
  vendor: string | null
  url: string | null
  image: ProductImage | null
  retailer: string | null
  country: string | null
  currency: string | null
  ships_to_nz: boolean | null
  stock_known: boolean | null
  gone: boolean | null
  action: string | null
}

/** One outfit with everything its page shows: the given one, or the newest. */
export async function getOutfit(id: number | null, sql: Sql = db()): Promise<OutfitView | null> {
  const [row] = await sql<OutfitRow[]>`
    select o.id::int as id, o.brief, o.source, ${STATUS_COLUMNS(sql)}, o.stage, o.title, o.started_at, o.finished_at,
           o.occasion, o.weather, o.why, o.styling, o.usd::float as usd, o.stats,
           coalesce(o.finished_at > now() - interval '20 seconds', false) as just_made,
           (select l.look_id::int from look_set_looks l where l.set_id = o.set_id order by l.position limit 1) as look_id
    from outfits o
    where ${id === null ? sql`true` : sql`o.id = ${id}`}
    order by o.started_at desc, o.id desc limit 1
  `
  if (!row) return null
  const { stats, look_id, ...outfit } = row
  const empty = { ...outfit, parts: [], look: null, dismissed: false, to_buy_cents: 0, on_me: null }
  if (outfit.status !== 'ready') return empty

  const [items, pieces, looks] = await Promise.all([
    sql<ItemRow[]>`
      with latest_action as (
        select distinct on (product_id) product_id, action
        from feed_actions order by product_id, created_at desc, id desc
      )
      select i.position, i.idea, i.piece_id::int as piece_id, i.product_id::int as product_id, i.why, i.price_cents, i.compare_at_cents,
             i.sizes, i.size_known, p.garment_type, p.title, p.vendor, p.url, p.main_image as image,
             r.name as retailer, r.country, r.currency, r.ships_to_nz,
             r.platform = any (${[...STOCK_PLATFORMS]}::text[]) as stock_known,
             p.removed_at is not null as gone, a.action
      from outfit_items i
      left join products p on p.id = i.product_id
      left join retailers r on r.id = p.retailer_id
      left join latest_action a on a.product_id = i.product_id
      where i.outfit_id = ${outfit.id}
      order by i.position
    `,
    listPieces(sql),
    look_id === null ? [] : getLooks([look_id], sql),
  ])
  const mine = new Map(pieces.map((piece) => [piece.id, piece]))
  const rates: Rates = { NZD: 1, ...(stats.fx?.rates ?? {}) }
  const parts = items.flatMap((item): OutfitPart[] => {
    if (item.piece_id !== null) {
      const piece = mine.get(item.piece_id)
      return piece ? [{ key: `p${piece.id}`, garment_type: piece.garment_type, name: piece.name, piece, product: null, idea: null }] : []
    }
    if (item.idea) {
      return [{ key: `i${item.position}`, garment_type: item.idea.garment_type, name: item.idea.name, piece: null, product: null, idea: item.idea }]
    }
    if (item.product_id === null || item.title === null || item.price_cents === null) return []
    return [
      {
        key: `f${item.product_id}`,
        garment_type: item.garment_type ?? 'accessory',
        name: item.title,
        piece: null,
        idea: null,
        product: {
          product_id: item.product_id,
          title: item.title,
          vendor: item.vendor,
          url: item.url!,
          image: item.image,
          retailer: item.retailer!,
          why: item.why,
          price: findPrice(
            { price_cents: item.price_cents, compare_at_cents: item.compare_at_cents, currency: item.currency!, country: item.country!, ships_to_nz: item.ships_to_nz! },
            rates,
          ),
          sizes: item.sizes,
          size_known: item.size_known,
          stock_known: item.stock_known ?? true,
          state: item.action === 'saved' || item.action === 'bought' ? item.action : null,
          gone: item.gone ?? false,
        },
      },
    ]
  })
  const look = looks[0] ?? null
  // A look carries its own picture; the rest are found by what they are made of, and one only described by its own id.
  const key = parts.some((part) => part.idea)
    ? describedKey(outfit.id)
    : outfitKey(parts.map((part) => ({ piece_id: part.piece?.id ?? null, product_id: part.product?.product_id ?? null })))
  const onMe = look || parts.length === 0 ? null : ((await tryOnsByKey([key], sql)).get(key) ?? null)
  return {
    ...outfit,
    parts,
    look: look && look.status !== 'dismissed' ? look : null,
    dismissed: look?.status === 'dismissed',
    to_buy_cents: parts.reduce((sum, part) => sum + (part.product && part.product.state !== 'bought' ? part.product.price.nzdCents : 0), 0),
    on_me: onMe,
  }
}
