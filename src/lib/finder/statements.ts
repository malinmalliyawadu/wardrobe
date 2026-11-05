import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import type { Slot } from '../blueprint.ts'
import { claude, MODELS } from '../claude.ts'
import type { Sql } from '../db.ts'
import type { Piece } from '../pieces.ts'
import { productImageAt } from '../product-image.ts'
import type { Profile, Sizes } from '../profile.ts'
import { WALKED_PLATFORMS } from '../retailers.ts'
import { finalText, plainDashes } from '../structured.ts'
import { colourNameFor, profileBrief, type Guide } from '../style-guide.ts'
import { BUDGET_CATEGORY, forEveryday, type GarmentType } from '../wardrobe-values.ts'

import { wantedSizeKeys } from './classify.ts'
import { familiesIn, productFamilies, type Family } from './colour.ts'
import type { Rates } from './filter.ts'
import { photoKey } from './filter.ts'
import { familiesOfColours } from './photo-colour.ts'
import {
  costUsd,
  IMAGE_WIDTH,
  judgeAll,
  parseJson,
  plainText,
  ScoreUsageError,
  type Log,
  type ScoreStats,
  type Usage,
} from './score.ts'
import type { ProductImage } from './shopify.ts'

/*
 * Stage 4 of the nightly run: statement pieces, asked for by Malin on
 * 2026-11-05. The slots of his blueprint are mostly the right basics; a
 * statement piece is the one in an outfit that carries it, by its colour, its
 * texture or its cut, and it rarely fills a slot.
 *
 *   rules  free: a piece he could wear (not tees, shorts, gym kit, caps or
 *          bags), in his size, under the most he would pay for one of its
 *          kind, not dismissed or bought, whose listing names one of his
 *          bold best colours, a texture, or a cut or detail. Patterns are not
 *          what he means, so a pattern alone never picks a piece.
 *   judge  Sonnet, once per version of a listing, against his profile, his
 *          guide and the pieces he owns: how good a statement piece it is
 *          for him, what makes it one, and what of his it wears with.
 *          Strongest signals first, so the nightly cap cuts the weakest.
 */

export const STATEMENT_THRESHOLD = 70

export const QUALITIES = ['colour', 'texture', 'cut'] as const
export type Quality = (typeof QUALITIES)[number]

export const QUALITY_LABELS: Record<Quality, string> = {
  colour: 'Colour',
  texture: 'Texture',
  cut: 'Cut',
}

/** The garments a statement piece can be, roughly in the order they carry an outfit. */
export const STATEMENT_GARMENTS = [
  'jacket',
  'coat',
  'overshirt',
  'tailoring',
  'knitwear',
  'shirt',
  'polo',
  'sweatshirt',
  'trousers',
  'accessory',
  'shoes',
  'boots',
  'jeans',
  'sneakers',
] as const satisfies readonly GarmentType[]

/** Accessories that can lead an outfit; caps are mostly logos, gloves and watches rarely read as one. */
export const STATEMENT_ACCESSORIES = ['scarf', 'beanie', 'tie'] as const

/** Families that are neutrals however deep: colour alone never makes these a statement. */
const QUIET: readonly Family[] = ['black', 'grey', 'white', 'ecru', 'beige', 'brown', 'navy']

/** Footwear's materials are its basics (every loafer is leather or suede), so only colour or cut pick it. */
const FOOTWEAR: readonly GarmentType[] = ['shoes', 'boots', 'sneakers']

const word = (source: string) => new RegExp(`(^|[^a-z])(${source})(?=$|[^a-z])`, 'i')

/*
 * Read in the title and the store's tags, which often name the material
 * ("_Boucle", ":Leather"). Not "quilted" (every puffer), nor herringbone or
 * seersucker, which are patterns, and patterns are not what he means.
 */
const TEXTURE = word(
  [
    'corduroy', 'cords?', 'needlecord', 'boucle', 'mohair', 'alpaca', 'suede', 'leather', 'shearling', 'sherpa',
    'teddy', 'pile', 'velvet', 'velour', 'chenille', 'moleskin', 'tweed', 'donegal', 'cable', 'cable[- ]?knit',
    'fisherman', 'aran', 'waffle', 'terry', 'towelling', 'toweling', 'crochet', 'textured',
  ].join('|'),
)

/*
 * Read in the title only: stores tag whole categories "Wide Leg" or
 * "Cropped". Not pleats or a wide leg, which are basics now.
 */
const CUT = word(
  [
    'camp', 'camp[- ]collar', 'cuban', 'revere', 'resort', 'bowling', 'boxy', 'cropped', 'double[- ]breasted',
    'shawl', 'funnel', 'funnel[- ]neck', 'barrel', 'balloon', 'western', 'popover', 'band[- ]collar', 'grand?dad',
    'johnny[- ]collar', 'tab[- ]collar', 'tassel', 'horsebit',
  ].join('|'),
)

/** "Bouclé" reads "boucle", so one spelling covers both. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/**
 * The colour families of his best colours that are not neutrals: rust, pine,
 * oxblood, teal for a deep autumn, never tobacco or ink navy. Named colours
 * first; a hex is read only when its name says nothing.
 */
export function statementFamilies(guide: Pick<Guide, 'palette'> | null): Family[] {
  const families = new Set<Family>()
  for (const colour of guide?.palette.best ?? []) {
    const named = familiesIn(colour.name)
    for (const family of named.length > 0 ? named : familiesOfColours([colour.hex])) families.add(family)
  }
  return [...families].filter((family) => !QUIET.includes(family))
}

export type StatementRow = {
  product_id: number
  content_hash: string
  title: string
  vendor: string | null
  product_type: string | null
  tags: string[]
  garment_type: GarmentType
  /** Colour options in stock in his size. */
  colours: string[]
  image_src: string | null
  image_colour_src: string | null
  image_colours: string[] | null
  sizes: string[]
  size_known: boolean
  price_cents: number
  compare_at_cents: number | null
  first_seen_at: Date
}

/** What in the listing made the rules pick it, in a fixed order; empty when nothing did. */
export function statementSignals(row: Omit<StatementRow, 'sizes' | 'size_known' | 'price_cents' | 'compare_at_cents' | 'first_seen_at'>, bold: Family[]): Quality[] {
  const title = plain(row.title)
  const text = plain([row.title, row.product_type ?? '', ...row.tags].join(' | '))
  const fromWords = productFamilies(row)
  const fromPhoto =
    row.image_src && row.image_colour_src === photoKey(row.image_src) ? familiesOfColours(row.image_colours ?? []) : []
  const families = fromWords.length > 0 ? fromWords : fromPhoto
  const footwear = FOOTWEAR.includes(row.garment_type)
  const signals: Quality[] = []
  if (families.some((family) => bold.includes(family))) signals.push('colour')
  if (!footwear && TEXTURE.test(text)) signals.push('texture')
  if (CUT.test(title)) signals.push('cut')
  return signals
}

export type StatementCandidate = {
  product_id: number
  content_hash: string
  signals: Quality[]
  sizes: string[]
  size_known: boolean
  price_cents: number
  compare_at_cents: number | null
}

/** Two signals before one, then the garments that carry an outfit, then the newest. */
export function rankCandidates<T extends { signals: Quality[]; garment_type: GarmentType; first_seen_at: Date; product_id: number }>(
  rows: T[],
): T[] {
  const weight = (garment: GarmentType) => (STATEMENT_GARMENTS as readonly GarmentType[]).indexOf(garment)
  return [...rows].sort(
    (a, b) =>
      b.signals.length - a.signals.length ||
      weight(a.garment_type) - weight(b.garment_type) ||
      b.first_seen_at.getTime() - a.first_seen_at.getTime() ||
      b.product_id - a.product_id,
  )
}

/**
 * The most he would pay for one of each garment, in NZD cents: his budget on
 * the profile when he gave one for its kind, otherwise the top of the
 * blueprint's bands for that garment, otherwise no ceiling.
 */
export function ceilings(budget: Profile['budget'], slots: Pick<Slot, 'garment_type' | 'budget_max_cents'>[]): Partial<Record<GarmentType, number>> {
  const result: Partial<Record<GarmentType, number>> = {}
  for (const garment of STATEMENT_GARMENTS) {
    const own = budget[BUDGET_CATEGORY[garment]]
    if (typeof own === 'number' && own > 0) {
      result[garment] = own * 100
      continue
    }
    const bands = slots.filter((slot) => slot.garment_type === garment && slot.budget_max_cents !== null)
    if (bands.length > 0) result[garment] = Math.max(...bands.map((slot) => slot.budget_max_cents!))
  }
  return result
}

/**
 * The rules: every piece the shops have that could be a statement for him,
 * best first. Free: SQL over what was read, and the words of each listing.
 */
export async function findStatementCandidates(
  sql: Sql,
  input: { sizes: Partial<Sizes>; budget: Profile['budget']; slots: Slot[]; guide: Pick<Guide, 'palette'> | null; rates: Rates },
): Promise<{ candidates: StatementCandidate[]; stats: { read: number; candidates: number; by_signal: Record<Quality, number> } }> {
  const bold = statementFamilies(input.guide)
  const keys: Partial<Record<GarmentType, string[]>> = {}
  for (const garment of STATEMENT_GARMENTS) {
    const wanted = wantedSizeKeys(garment, [], input.sizes)
    if (wanted) keys[garment] = wanted
  }
  const maxCents = ceilings(input.budget, input.slots)

  const rows = await sql<StatementRow[]>`
    with wanted as (
      select key as garment_type, array(select jsonb_array_elements_text(value)) as keys
      from jsonb_each(${sql.json(keys)})
    ),
    ceilings as (
      select key as garment_type, value::numeric as max_cents from jsonb_each_text(${sql.json(maxCents)})
    ),
    rates as (
      select key as currency, value::numeric as rate from jsonb_each_text(${sql.json(input.rates)})
    ),
    latest_action as (
      select distinct on (product_id) product_id, action
      from feed_actions order by product_id, created_at desc, id desc
    )
    select p.id::int as product_id, p.content_hash, p.title, p.vendor, p.product_type, p.tags, p.garment_type,
           p.images -> 0 ->> 'src' as image_src, p.image_colour_src, p.image_colours, p.first_seen_at,
           v.colours, v.sizes, w.keys is not null or v.one_size as size_known, v.price_cents, v.compare_at_cents
    from products p
    join retailers r on r.id = p.retailer_id and r.enabled and r.platform = any (${[...WALKED_PLATFORMS]}::text[])
    join rates x on x.currency = r.currency
    left join wanted w on w.garment_type = p.garment_type
    left join ceilings c on c.garment_type = p.garment_type
    cross join lateral (
      select min(pv.price_cents)::int as price_cents,
             (array_agg(pv.compare_at_cents order by pv.price_cents))[1]::int as compare_at_cents,
             -- In the store's own order; one row per colour repeats a size, so they are de-duplicated after.
             coalesce(array_agg(pv.option_size order by pv.id) filter (where pv.option_size is not null), '{}') as sizes,
             coalesce(array_agg(distinct pv.option_colour) filter (where pv.option_colour is not null), '{}') as colours,
             bool_and(coalesce(pv.size_key = 'ONE', false)) as one_size
      from product_variants pv
      where pv.product_id = p.id and pv.available and pv.price_cents > 0
        and (w.keys is null or pv.size_key = any (w.keys))
        and (c.max_cents is null or pv.price_cents * x.rate <= c.max_cents)
      having count(*) > 0
    ) v
    where p.removed_at is null
      and p.menswear
      and p.garment_type = any (${STATEMENT_GARMENTS as unknown as string[]}::text[])
      and (p.garment_type <> 'accessory' or p.garment_kind = any (${STATEMENT_ACCESSORIES as unknown as string[]}::text[]))
      and not exists (
        select 1 from latest_action a where a.product_id = p.id and a.action in ('dismissed', 'bought')
      )
  `

  const picked = rows.flatMap((row) => {
    const signals = statementSignals(row, bold)
    return signals.length > 0 ? [{ ...row, signals }] : []
  })
  const by_signal = { colour: 0, texture: 0, cut: 0 }
  for (const row of picked) for (const signal of row.signals) by_signal[signal] += 1
  const candidates = rankCandidates(picked).map((row) => ({
    product_id: row.product_id,
    content_hash: row.content_hash,
    signals: row.signals,
    sizes: [...new Set(row.sizes)],
    size_known: row.size_known,
    price_cents: row.price_cents,
    compare_at_cents: row.compare_at_cents,
  }))
  return { candidates, stats: { read: rows.length, candidates: candidates.length, by_signal } }
}

export async function recordStatementCandidates(sql: Sql, runId: number, candidates: StatementCandidate[]): Promise<void> {
  for (let start = 0; start < candidates.length; start += 2000) {
    const rows = candidates.slice(start, start + 2000).map((candidate) => ({ run_id: runId, ...candidate }))
    await sql`insert into statement_candidates ${sql(rows)}`
  }
}

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------

export const StatementSchema = z.object({
  qualities: z
    .array(z.enum(QUALITIES))
    .describe(
      'What makes it stand out, judged from the photo: its colour, its texture, its cut or a detail. Empty when nothing does, which makes it a basic.',
    ),
  score: z.number().int().min(0).max(100).describe('0 to 100 as a statement piece for him, on the scale in the instructions.'),
  colour: z
    .string()
    .nullable()
    .describe('The colour option you judged, copied exactly from the colours offered in his size, or null when there is only one.'),
  why: z
    .string()
    .describe(
      'One sentence to him, under 25 words: what makes it a statement and how to wear it, naming one of his pieces when one suits. Plain and specific, no sales talk.',
    ),
  wears_with: z
    .array(z.number().int())
    .describe('The ids of up to three of his pieces it wears with best in one outfit, quiet ones that let it lead. Empty when nothing he owns suits it.'),
})

export type StatementOutput = z.infer<typeof StatementSchema>

export const STATEMENT_SYSTEM_PROMPT = `You are an experienced menswear stylist working for one client. Every night a private app reads New Zealand menswear shops and END. (UK, ships to New Zealand). It already looks for the basics his wardrobe blueprint asks for. You look for something else: statement pieces, the one piece in an outfit that carries it, so everything else can stay quiet.

For him a piece is a statement by one or more of:
- colour: a deep or saturated colour from his best colours, not a neutral
- texture: a surface you notice across a room: corduroy, boucle, mohair, suede, shearling, a chunky cable, terry, crochet, velvet, tweed
- cut or detail: a shape or detail that departs from the standard version: a camp collar, a boxy or cropped body, pleats, a wide leg, a shawl collar, a western yoke

Patterns (checks, stripes, prints), graphics, slogans and logos are not what he means: a piece whose interest is mostly a pattern or a logo scores below 40.

Score each product 0 to 100 as a statement piece for him:
- 90 to 100: a piece to build several outfits around. It clearly stands out, its colour is one of his best colours (or a neutral carried by its texture or cut), the cut follows his rules, the make earns it, and it wears with things he owns.
- 75 to 89: a strong statement for him, with one small compromise you name.
- 60 to 74: it stands out, but only partly suits him: the colour is near his palette rather than in it, the make is ordinary, or it is hard to wear with what he owns.
- 40 to 59: it barely stands out, or stands out in a way that works against him.
- Below 40: a basic, mostly a pattern or a logo, a colour from his avoid list near the face, or not for him.

The rules that picked it out read only the listing's words and may be wrong: a "cord" can be a drawcord, "cropped" a trouser length, "camp" a brand name. Judge from the photo as well as the listing. Compare colours against his palette hexes, as a studio photo flatters; when several colours are offered in his size, judge the best of them for him and name it. Judge the cut against the guide's rules for his height and build. Respect his no-gos absolutely. Products he dismissed lately, with his reason, tell you what he does not want.

For wears_with, name only ids from his pieces. Price is not your concern: the app has already checked his budget. Do not invent facts the listing does not give. Write to him in the second person, in plain English, and use a plain hyphen rather than a dash.`

export type StatementContext = {
  profile: Profile
  guide: Guide
  pieces: Piece[]
  dismissals: { title: string; reason: string | null; note: string | null }[]
}

/** The pieces the judge may pair it with: in the wardrobe and worn every day. */
export function wearablePieces(pieces: Piece[]): Piece[] {
  return pieces.filter((piece) => !piece.set_aside_at && piece.garment_type !== 'activewear' && forEveryday(piece))
}

/** The cached half of every call; its text must not change within a run. */
export function statementContextBlock(context: StatementContext): string {
  const pieces = wearablePieces(context.pieces).map((piece) => ({
    id: piece.id,
    name: piece.name,
    garment: piece.garment_type,
    colour: piece.colour_hex ? (colourNameFor(context.guide, piece.colour_hex) ?? piece.colour_name) : piece.colour_name,
    fabric: piece.fabric,
    fit: piece.fit,
  }))
  const parts = [
    `His profile:\n\n${JSON.stringify(profileBrief(context.profile))}`,
    `His style guide:\n\n${JSON.stringify({
      palette: context.guide.palette,
      silhouette: context.guide.silhouette,
      shoes: context.guide.shoes,
      accessories: context.guide.accessories,
      fit_vocabulary: context.guide.fit_vocabulary,
    })}`,
    pieces.length > 0
      ? `The pieces he owns:\n\n${JSON.stringify(pieces)}`
      : 'He has not added the pieces he owns yet, so leave wears_with empty and judge against his guide alone.',
  ]
  if (context.dismissals.length > 0) {
    parts.push(`Products he dismissed lately, most recent first:\n\n${JSON.stringify(context.dismissals)}`)
  }
  return parts.join('\n\n')
}

export type ProductForStatement = {
  product_id: number
  content_hash: string
  retailer: string
  title: string
  vendor: string | null
  product_type: string | null
  tags: string[]
  body_html: string | null
  images: ProductImage[]
  colours: string[]
  sizes: string[]
  signals: Quality[]
}

export function buildStatementRequest(context: string, product: ProductForStatement) {
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
      `The rules picked it for its ${product.signals.join(' and ')}.`,
    ].join('\n\n'),
  })

  // Without `parse`, the SDK passes the schema through and leaves the text alone.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parse: _parse, ...format } = zodOutputFormat(StatementSchema)
  return {
    model: MODELS.scoring,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: [
      { type: 'text' as const, text: STATEMENT_SYSTEM_PROMPT },
      { type: 'text' as const, text: context, cache_control: { type: 'ephemeral' as const } },
    ],
    messages: [{ role: 'user' as const, content }],
    output_config: { effort: 'low' as const, format },
  }
}

/**
 * Holds Claude to what it was given: colours on sale, pieces he owns (three at
 * most), each quality once. Nothing that stands out is not a statement, so it
 * stays under the bar whatever the number said.
 */
export function tidyStatement(
  output: StatementOutput,
  product: Pick<ProductForStatement, 'colours'>,
  pieceIds: ReadonlySet<number>,
): StatementOutput {
  const qualities = QUALITIES.filter((quality) => output.qualities.includes(quality))
  let score = Math.max(0, Math.min(100, Math.round(output.score)))
  if (qualities.length === 0) score = Math.min(score, 39)
  return plainDashes({
    ...output,
    qualities,
    score,
    colour: output.colour !== null && product.colours.includes(output.colour) ? output.colour : null,
    wears_with: [...new Set(output.wears_with)].filter((id) => pieceIds.has(id)).slice(0, 3),
  }) as StatementOutput
}

export async function judgeStatement(
  context: string,
  product: ProductForStatement,
  pieceIds: ReadonlySet<number>,
): Promise<{ output: StatementOutput; usage: Usage; servedBy: string }> {
  const response = await claude().beta.messages.create(buildStatementRequest(context, product), { maxRetries: 5 })
  const usage: Usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
  }
  if (response.stop_reason === 'refusal') throw new ScoreUsageError('declined', usage)
  if (response.stop_reason === 'max_tokens') throw new ScoreUsageError('cut off', usage)
  const parsed = StatementSchema.safeParse(parseJson(finalText(response.content)))
  if (!parsed.success) throw new ScoreUsageError('unexpected shape', usage)
  return { output: tidyStatement(parsed.data, product, pieceIds), usage, servedBy: response.model }
}

/** The candidates with no verdict for their current version, in the rules' order. */
export async function unjudgedStatements(sql: Sql, candidates: StatementCandidate[]): Promise<ProductForStatement[]> {
  if (candidates.length === 0) return []
  const offered = candidates.map((candidate) => ({ product_id: candidate.product_id }))
  const rows = await sql<(Omit<ProductForStatement, 'sizes' | 'signals' | 'colours'> & { colours: string[] | null })[]>`
    with offered as (
      select * from jsonb_to_recordset(${sql.json(offered)}) as o(product_id bigint)
    )
    select p.id::int as product_id, p.content_hash, r.name as retailer, p.title, p.vendor, p.product_type,
           p.tags, p.body_html, p.images,
           (select array_agg(distinct v.option_colour) from product_variants v
             where v.product_id = p.id and v.available and v.option_colour is not null) as colours
    from offered o
    join products p on p.id = o.product_id
    join retailers r on r.id = p.retailer_id
    where not exists (
      select 1 from statement_scores s where s.product_id = p.id and s.content_hash = p.content_hash
    )
  `
  const byId = new Map(rows.map((row) => [row.product_id, row]))
  return candidates.flatMap((candidate) => {
    const row = byId.get(candidate.product_id)
    return row ? [{ ...row, colours: row.colours ?? [], sizes: candidate.sizes, signals: candidate.signals }] : []
  })
}

async function saveStatement(
  sql: Sql,
  runId: number,
  product: ProductForStatement,
  output: StatementOutput,
  usage: Usage,
  servedBy: string,
): Promise<void> {
  const row = {
    product_id: product.product_id,
    content_hash: product.content_hash,
    score: output.score,
    qualities: output.qualities,
    colour_option: output.colour,
    why: output.why,
    wears_with: output.wears_with,
    model: MODELS.scoring,
    served_by: servedBy,
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_tokens: usage.cacheRead,
    cache_write_tokens: usage.cacheWrite,
    usd: costUsd(usage),
    run_id: runId,
    scored_at: new Date(),
  }
  await sql`
    insert into statement_scores ${sql(row)}
    on conflict (product_id, content_hash) do nothing
  `
}

export async function judgeStatements(
  sql: Sql,
  runId: number,
  context: StatementContext,
  products: ProductForStatement[],
  options: {
    maxUsd: number
    concurrency: number
    log: Log
    /** The call itself; tests pass a fake. */
    judgeOne?: typeof judgeStatement
  },
): Promise<ScoreStats> {
  const pieceIds = new Set(wearablePieces(context.pieces).map((piece) => piece.id))
  const judgeOne = options.judgeOne ?? judgeStatement
  return judgeAll(sql, runId, statementContextBlock(context), products, {
    maxUsd: options.maxUsd,
    concurrency: options.concurrency,
    log: options.log,
    event: 'statements',
    judgeOne: (block, product) => judgeOne(block, product, pieceIds),
    save: saveStatement,
  })
}
