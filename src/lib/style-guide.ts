import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { parseStoredAnalysis } from './analysis.ts'
import { db } from './db.ts'
import { finish, rows, text, type ParseResult } from './form-parse.ts'
import { FITS, type Fit, type Season } from './profile-values.ts'
import type { Profile } from './profile.ts'
import { SEASON_INFO } from './seasons.ts'
import { generate, type GenerationMeta } from './structured.ts'
import { GARMENT_TYPES, METALS, normaliseHex } from './wardrobe-values.ts'

/*
 * The style guide: what suits Malin, as structured data the blueprint and the
 * finder read. Generated once from the confirmed profile, then editable section
 * by section. Each section is one jsonb column on the style_guide row.
 */

const hex = z.string().describe('Six-digit hex, "#rrggbb"')
const colourName = z.string().describe('Short, as a tailor would name it: "pine", "tobacco", "oxblood"')

const ColourSchema = z.object({
  hex,
  name: colourName,
  use: z.string().describe('Where it works best for him, a few words: "knitwear and overshirts"'),
})

const AvoidSchema = z.object({
  hex,
  name: colourName,
  why: z.string().describe('A few words on what it does to him: "washes out the warmth in your skin"'),
})

export const PaletteSchema = z.object({
  summary: z.string().describe('One or two sentences to him on how his palette works.'),
  best: z
    .array(ColourSchema)
    .describe('8 to 12 best colours, strongest and most wearable first. The first five are shown on his home screen.'),
  neutrals: z
    .array(ColourSchema)
    .describe('4 to 6 best neutrals, for trousers, outerwear, shoes and the base of an outfit.'),
  avoid: z.array(AvoidSchema).describe('3 to 6 colours to avoid near the face.'),
  metal: z.enum(METALS).describe('Metal tone for hardware, watches, buckles and frames'),
  metal_why: z.string().describe('One sentence on why that metal.'),
})

const RuleSchema = z.object({
  topic: z.string().describe('Two or three words: "trouser rise", "hem break"'),
  rule: z.string().describe('One or two sentences to him, specific to his height and build.'),
})

export const SectionSchema = z.object({
  summary: z.string().describe('One sentence that the rules below follow from.'),
  rules: z.array(RuleSchema),
})

export const FitSchema = z.object({
  garment: z.enum(GARMENT_TYPES),
  fits: z.array(z.enum(FITS)).describe('The retailer fit labels that work for him on this garment.'),
  note: z.string().describe('A few words on what to look for in the cut.'),
})

export const GuideSchema = z.object({
  palette: PaletteSchema,
  silhouette: SectionSchema.describe(
    'Silhouette and proportion rules: trouser rise, hem break, jacket and outerwear length, where to put visual weight, pattern scale, fabric weight. Five to eight rules.',
  ),
  shoes: SectionSchema.describe('Shoe shapes, toe, sole and heel height that work with the trouser rules. Three to five rules.'),
  accessories: SectionSchema.describe(
    'Watch size, bag scale, glasses frames, scarves and hats for Wellington wind. Four to six rules.',
  ),
  fit_vocabulary: z
    .array(FitSchema)
    .describe('One entry per clothing garment type he would wear; skip accessories and bags.'),
})

export type Palette = z.infer<typeof PaletteSchema>
export type Section = z.infer<typeof SectionSchema>
export type FitEntry = z.infer<typeof FitSchema>
export type Guide = z.infer<typeof GuideSchema>
export type GuideColour = z.infer<typeof ColourSchema>
export type RuleSectionName = 'silhouette' | 'shoes' | 'accessories'

export type StoredGuide = Guide & {
  model: string | null
  generated_at: Date | null
  edited_at: Date | null
}

export class StyleGuideError extends Error {}

/*
 * The profile as Claude sees it. Shared with the blueprint call so both read
 * the same facts. Empty groups are left out rather than sent as nulls, and the
 * prompt says what that means.
 */
export function profileBrief(profile: Profile): Record<string, unknown> {
  const analysis = parseStoredAnalysis(profile.analysis)
  const runnerUp: Season | null = analysis?.colouring.runner_up_season ?? null
  const season = profile.season

  const seasons: Record<string, unknown> = {}
  if (season) seasons[season] = { ...SEASON_INFO[season], role: 'his confirmed season' }
  if (runnerUp && runnerUp !== season) seasons[runnerUp] = { ...SEASON_INFO[runnerUp], role: 'runner-up' }

  return compact({
    colouring: {
      season,
      season_confidence: profile.season_confidence,
      runner_up_season: runnerUp,
      undertone: profile.undertone,
      skin_depth: profile.skin_depth,
      contrast: profile.contrast_level,
      hair: [profile.hair_colour, profile.hair_texture].filter(Boolean).join(', ') || null,
      eyes: profile.eye_colour,
    },
    proportions: {
      height_cm: profile.height_cm,
      build: profile.build,
      shoulder_hip: profile.shoulder_hip,
      torso_leg: profile.torso_leg,
      neck_length: profile.neck_length,
    },
    sizes: profile.sizes,
    fit_preferences: profile.fit_preferences,
    life_days_per_week: profile.life,
    taste: profile.taste,
    budget_ceilings_nzd: profile.budget,
    season_table: seasons,
  })
}

/** Drops nulls, empty strings and empty objects, recursively. */
function compact(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (inner === null || inner === undefined || inner === '') continue
    if (typeof inner === 'object' && !Array.isArray(inner)) {
      const nested = compact(inner as Record<string, unknown>)
      if (Object.keys(nested).length > 0) out[key] = nested
      continue
    }
    out[key] = inner
  }
  return out
}

export const GUIDE_SYSTEM_PROMPT = `You are an experienced menswear stylist writing a personal style guide for one client. His profile comes from a colour and proportion read he has confirmed, plus what he typed in. The guide feeds a private app that drafts his wardrobe and finds clothes for him in Wellington, New Zealand, so it must be concrete enough to filter real products against.

Wellington: mild and changeable, rarely hot, rarely freezing, wind most days and rain often. People dress in layers year round, and outerwear does a lot of work.

Palette. Start from his season and the season table, then make it his: adjust for his undertone, depth and contrast as confirmed. Name colours the way a tailor or a mill would, and give real hex values you would match fabric against. The best colours are colours he can actually buy in menswear (knitwear, shirts, outerwear, trousers), not paint chips. Neutrals are the base of most outfits. Colours to avoid are the ones that work against him near the face. The metal follows his undertone.

When his season confidence is below 70, the runner-up is still in play. Lean the neutrals and the most expensive pieces toward colours that work in both seasons, and say so in the palette summary.

Silhouette and proportion. Write rules for his height and build, with numbers where a stylist would give them (rise, break, jacket length relative to the seat, collar and lapel scale). Say where to put visual weight given his shoulder to hip relationship, which pattern scale suits his frame, and what fabric weight works for Wellington.

Shoes follow the trouser rules. Accessories cover watch case size for his wrist and frame, bag scale, glasses frames for his colouring, and scarves and hats that survive the wind.

Fit vocabulary. For each clothing garment type he would wear, list the retailer fit labels (slim, regular, relaxed, oversized) that work on him, respecting his stated fit preferences, with a few words on what to look for in the cut.

Where a profile group is missing, he has not filled it in yet. Do not invent facts about him; give advice that holds without them. Write every rule to him in the second person, in plain English, short enough to read on a phone. No brand names.`

export function buildGuideMessages(profile: Profile): Anthropic.Beta.BetaMessageParam[] {
  return [
    {
      role: 'user',
      content: `His profile:\n\n${JSON.stringify(profileBrief(profile), null, 2)}\n\nWrite his style guide.`,
    },
  ]
}

/** Opus at high effort, once, from the confirmed profile. */
export async function draftGuide(profile: Profile): Promise<{ guide: Guide; meta: GenerationMeta }> {
  if (!profile.confirmed_at || !profile.season) {
    throw new StyleGuideError('Confirm your colouring first. The guide is built on it.')
  }
  const { data, meta } = await generate({
    schema: GuideSchema,
    system: GUIDE_SYSTEM_PROMPT,
    messages: buildGuideMessages(profile),
    maxTokens: 32000,
    what: 'style guide',
  })
  return { guide: normaliseGuide(data), meta }
}

/** Hex values tidied, colours without a usable hex dropped, fits de-duplicated. */
export function normaliseGuide(guide: Guide): Guide {
  return {
    ...guide,
    palette: {
      ...guide.palette,
      best: tidyColours(guide.palette.best),
      neutrals: tidyColours(guide.palette.neutrals),
      avoid: tidyColours(guide.palette.avoid),
    },
    fit_vocabulary: guide.fit_vocabulary.map((entry) => ({
      ...entry,
      fits: FITS.filter((fit) => entry.fits.includes(fit)),
    })),
  }
}

function tidyColours<T extends { hex: string }>(colours: T[]): T[] {
  return colours.flatMap((colour) => {
    const value = normaliseHex(colour.hex)
    return value ? [{ ...colour, hex: value }] : []
  })
}

/** The colours a slot may be drawn from: best colours, then neutrals. */
export function guideColours(guide: Pick<Guide, 'palette'>): GuideColour[] {
  return [...guide.palette.best, ...guide.palette.neutrals]
}

/** The name the guide gives a hex, if any. */
export function colourNameFor(guide: Pick<Guide, 'palette'> | null, value: string): string | null {
  if (!guide) return null
  return guideColours(guide).find((colour) => colour.hex === value)?.name ?? null
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

type GuideRow = {
  palette: unknown
  silhouette: unknown
  shoes: unknown
  accessories: unknown
  fit_vocabulary: unknown
  model: string | null
  generated_at: Date | null
  edited_at: Date | null
}

/** Read the guide row back, or null if none has been drafted or its shape is stale. */
export function parseStoredGuide(row: GuideRow | undefined): StoredGuide | null {
  if (!row?.generated_at) return null
  const result = GuideSchema.safeParse({
    palette: row.palette,
    silhouette: row.silhouette,
    shoes: row.shoes,
    accessories: row.accessories,
    fit_vocabulary: row.fit_vocabulary,
  })
  if (!result.success) return null
  return { ...result.data, model: row.model, generated_at: row.generated_at, edited_at: row.edited_at }
}

export async function getGuide(): Promise<StoredGuide | null> {
  const [row] = await db()<GuideRow[]>`
    select palette, silhouette, shoes, accessories, fit_vocabulary, model, generated_at, edited_at
    from style_guide where id = 1
  `
  return parseStoredGuide(row)
}

type Json = Parameters<ReturnType<typeof db>['json']>[0]

export async function saveGuide(guide: Guide, meta: GenerationMeta): Promise<void> {
  const sql = db()
  await sql`
    insert into style_guide (id, palette, silhouette, shoes, accessories, fit_vocabulary, model, generated_at, edited_at)
    values (1, ${sql.json(guide.palette as Json)}, ${sql.json(guide.silhouette as Json)},
            ${sql.json(guide.shoes as Json)}, ${sql.json(guide.accessories as Json)},
            ${sql.json(guide.fit_vocabulary as Json)}, ${meta.served_by}, now(), null)
    on conflict (id) do update
    set palette = excluded.palette,
        silhouette = excluded.silhouette,
        shoes = excluded.shoes,
        accessories = excluded.accessories,
        fit_vocabulary = excluded.fit_vocabulary,
        model = excluded.model,
        generated_at = excluded.generated_at,
        edited_at = null
  `
}

export async function savePalette(palette: Palette): Promise<void> {
  const sql = db()
  await sql`update style_guide set palette = ${sql.json(palette as Json)}, edited_at = now() where id = 1`
}

export async function saveSection(name: RuleSectionName, section: Section): Promise<void> {
  const sql = db()
  const value = sql.json(section as Json)
  // One statement per column rather than an identifier from input.
  if (name === 'silhouette') await sql`update style_guide set silhouette = ${value}, edited_at = now() where id = 1`
  if (name === 'shoes') await sql`update style_guide set shoes = ${value}, edited_at = now() where id = 1`
  if (name === 'accessories') await sql`update style_guide set accessories = ${value}, edited_at = now() where id = 1`
}

export async function saveFits(fits: FitEntry[]): Promise<void> {
  const sql = db()
  await sql`update style_guide set fit_vocabulary = ${sql.json(fits as Json)}, edited_at = now() where id = 1`
}

// ---------------------------------------------------------------------------
// Forms. Each section is edited on its own page; repeating rows are posted as
// prefix.index.field and blank rows are ignored.
// ---------------------------------------------------------------------------

export const RULE_SECTIONS: RuleSectionName[] = ['silhouette', 'shoes', 'accessories']

export function isRuleSection(value: string): value is RuleSectionName {
  return (RULE_SECTIONS as string[]).includes(value)
}

const COLOUR_FIELDS = ['hex', 'name', 'use'] as const
const AVOID_FIELDS = ['hex', 'name', 'why'] as const

function colourRows<F extends 'use' | 'why'>(
  form: FormData,
  prefix: string,
  fields: readonly ['hex', 'name', F],
  errors: Record<string, string>,
): ({ hex: string; name: string } & Record<F, string>)[] {
  const out: ({ hex: string; name: string } & Record<F, string>)[] = []
  for (const row of rows(form, prefix, fields)) {
    const value = normaliseHex(row.values.hex)
    if (!value) errors[`${prefix}.${row.index}.hex`] = 'Use a hex value like #7a2e1f'
    if (!row.values.name) errors[`${prefix}.${row.index}.name`] = 'Name the colour'
    if (value && row.values.name) out.push({ ...row.values, hex: value })
  }
  return out
}

export function parsePaletteForm(form: FormData): ParseResult<Palette> {
  const errors: Record<string, string> = {}
  const best = colourRows(form, 'best', COLOUR_FIELDS, errors)
  const neutrals = colourRows(form, 'neutrals', COLOUR_FIELDS, errors)
  const avoid = colourRows(form, 'avoid', AVOID_FIELDS, errors)
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  if (best.length === 0) return { ok: false, errors: { best: 'Keep at least one best colour' } }
  return finish(PaletteSchema, {
    summary: text(form, 'summary') ?? '',
    best,
    neutrals,
    avoid,
    metal: text(form, 'metal'),
    metal_why: text(form, 'metal_why') ?? '',
  })
}

export function parseSectionForm(form: FormData): ParseResult<Section> {
  const errors: Record<string, string> = {}
  const rules: Section['rules'] = []
  for (const row of rows(form, 'rules', ['topic', 'rule'] as const)) {
    if (!row.values.topic) errors[`rules.${row.index}.topic`] = 'Give it a topic'
    if (!row.values.rule) errors[`rules.${row.index}.rule`] = 'Write the rule, or clear the row'
    if (row.values.topic && row.values.rule) rules.push({ topic: row.values.topic, rule: row.values.rule })
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return finish(SectionSchema, { summary: text(form, 'summary') ?? '', rules })
}

export function parseFitsForm(form: FormData): ParseResult<FitEntry[]> {
  const errors: Record<string, string> = {}
  const entries: FitEntry[] = []
  const seen = new Set<string>()
  for (const row of rows(form, 'fits', ['garment', 'note', ...FITS] as const)) {
    const garment = row.values.garment
    if (!(GARMENT_TYPES as readonly string[]).includes(garment)) {
      errors[`fits.${row.index}.garment`] = 'Pick a garment'
      continue
    }
    if (seen.has(garment)) {
      errors[`fits.${row.index}.garment`] = 'Already listed above'
      continue
    }
    seen.add(garment)
    const fits = FITS.filter((fit: Fit) => row.values[fit] !== '')
    if (fits.length === 0) {
      errors[`fits.${row.index}.garment`] = 'Tick at least one fit'
      continue
    }
    entries.push({ garment: garment as FitEntry['garment'], fits, note: row.values.note })
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, data: entries }
}
