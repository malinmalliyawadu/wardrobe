import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { db } from './db.ts'
import { finish, list, number, text, type ParseResult } from './form-parse.ts'
import { FITS, type Fit } from './profile-values.ts'
import type { Profile } from './profile.ts'
import { syncSlotPieces } from './pieces.ts'
import { generate, type GenerationMeta } from './structured.ts'
import { guideColours, profileBrief, type Guide } from './style-guide.ts'
import {
  BUDGET_CATEGORY,
  GARMENT_TYPES,
  SLOT_STATUSES,
  normaliseHex,
  type GarmentType,
  type Priority,
  type SlotStatus,
} from './wardrobe-values.ts'

/*
 * The blueprint: 30 to 40 named slots, each a specific archetype item with a
 * why, a priority, a budget band and a status. Claude drafts it from the
 * profile and the style guide; Malin edits, reorders and adds to it; the
 * finder (M3) matches products against the wanted slots.
 */

export const SlotDraftSchema = z.object({
  name: z
    .string()
    .describe('The archetype as he would say it in a shop: "navy unstructured wool overshirt". Colour, fabric and garment; no brands.'),
  why: z
    .string()
    .describe('One sentence to him, under 30 words, naming the reason in his palette, proportions or week.'),
  priority: z.number().int().min(1).max(3).describe('1 buy first, 2 next, 3 in time'),
  garment_type: z.enum(GARMENT_TYPES),
  colour_family: z.string().describe('The colour in plain words: "dark brown", "navy", "ecru"'),
  colours: z
    .array(z.string())
    .describe('One to three hex values, each copied exactly from the guide palette (best colours or neutrals).'),
  fabrics: z.array(z.string()).describe('One to three fabrics in preference order: "merino", "brushed cotton"'),
  fit: z.enum(FITS).nullable().describe('Retailer fit label from the guide fit vocabulary, or null for shoes and accessories'),
  sizes: z.object({
    labels: z
      .array(z.string())
      .describe('Size labels to look for on a retailer page: "S", "EU 42", "30". Empty if his size is unknown.'),
    note: z.string().nullable().describe('A short sizing note, or null.'),
  }),
  budget_nzd: z.object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
  status: z.enum(['wanted', 'owned']).describe('"owned" only for staples he already owns and listed under taste'),
})

export const BlueprintSchema = z.object({
  slots: z.array(SlotDraftSchema).describe('30 to 40 slots in buying order: all priority 1 first, then 2, then 3.'),
})

export const RefillSchema = z.object({ slot: SlotDraftSchema })

export type SlotDraft = z.infer<typeof SlotDraftSchema>

export type Slot = {
  id: number
  position: number
  name: string
  why: string
  priority: Priority
  garment_type: GarmentType
  colour_family: string | null
  colours: string[]
  fabrics: string[]
  fit: Fit | null
  sizes: { labels?: string[]; note?: string | null }
  budget_min_cents: number | null
  budget_max_cents: number | null
  status: SlotStatus
  source: 'claude' | 'malin'
  edited_at: Date | null
  replaces_id: number | null
  /** Set on a retired slot once a refill has taken its place. */
  refilled_by: number | null
}

export class BlueprintError extends Error {}

export const BLUEPRINT_SYSTEM_PROMPT = `You are an experienced menswear stylist drafting a wardrobe blueprint for one client: the list of specific items he should own, in the order he should buy them. You have his confirmed profile and the style guide written for him. A private app shows him the list and, every night, searches Wellington and online menswear shops for real products that fill each wanted slot, so every slot must be specific enough to match a product page against.

A slot is an archetype, not a product: garment, colour, fabric and cut, the way he would describe it to a good shop assistant ("dark brown suede chukka boot", "ecru heavyweight cotton crew tee"). No brands. Each slot earns its place in the whole: together they should dress his actual week in Wellington (mild, windy, often wet, layers year round) with pieces that combine with each other. Prefer fewer, better, versatile pieces over novelty; do not repeat near-identical slots unless the repetition is real (a tee he wears four days a week can be two slots in two colours).

Priority. 1 is the foundation he would buy first: worn most often, filling the biggest gaps, unlocking the most outfits; around a third of the list. 2 rounds it out. 3 is occasional pieces and upgrades. Within each priority, order is buying order. Return the slots in that order.

Colour. Every hex in a slot's colours must be copied exactly from the guide palette (best colours or neutrals); put the more expensive, longer-lived pieces in the neutrals or in colours that also work for his runner-up season when his season confidence is below 70. colour_family names the colour in plain words.

Fit and size. Use the guide's fit vocabulary for the garment type and his stated fit preferences. Size labels come from his sizes; leave them empty when the profile does not give that size, and use the note to say what to measure.

Budget. Give each slot a realistic band in whole New Zealand dollars for that quality at New Zealand menswear prices. When he has set a ceiling for the category, the band's maximum must not exceed it. When he has set a monthly figure, make the priority 1 list affordable over a few months of it.

Owned. Every staple he lists as already owned and happy with becomes a slot with status "owned", with its own why, instead of a new want for the same thing. Build the rest around those pieces.

Respect his no-gos absolutely. Where a profile group is missing, he has not filled it in yet: do not invent hobbies, sports or a job he has not told you about; dress a man in Wellington with office days, weekends and evenings out, and keep the list general where the profile is silent.

The why is one sentence to him in the second person, under 30 words, naming the specific reason: a palette fact, a proportion rule from the guide, or a part of his week. Not generic praise.`

const REFILL_SYSTEM_PROMPT = `${BLUEPRINT_SYSTEM_PROMPT}

You are now refilling one slot. He has retired it: he no longer wants that item in the blueprint. Propose one new slot that takes its place in the whole, at the same priority unless the rest of the blueprint makes another priority clearly right. Do not duplicate any slot he already has, and do not bring back the retired item in another colour unless his note asks for it.`

/** A slot as Claude sees it, without database ids and timestamps. */
function slotForPrompt(slot: Slot): Record<string, unknown> {
  return {
    name: slot.name,
    why: slot.why,
    priority: slot.priority,
    garment_type: slot.garment_type,
    colour_family: slot.colour_family,
    colours: slot.colours,
    fabrics: slot.fabrics,
    fit: slot.fit,
    budget_nzd: { min: dollars(slot.budget_min_cents), max: dollars(slot.budget_max_cents) },
    status: slot.status,
  }
}

function guideForPrompt(guide: Guide): Record<string, unknown> {
  return {
    palette: guide.palette,
    silhouette: guide.silhouette,
    shoes: guide.shoes,
    accessories: guide.accessories,
    fit_vocabulary: guide.fit_vocabulary,
  }
}

export function buildDraftMessages(
  profile: Profile,
  guide: Guide,
  kept: Slot[],
  note: string | null,
): Anthropic.Beta.BetaMessageParam[] {
  const parts = [
    `His profile:\n\n${JSON.stringify(profileBrief(profile), null, 2)}`,
    `His style guide:\n\n${JSON.stringify(guideForPrompt(guide), null, 2)}`,
  ]
  if (kept.length > 0) {
    parts.push(
      `These ${kept.length} slots stay in the blueprint as they are (he wrote them, edited them, owns them or has a candidate for them). Do not return them again and do not duplicate them; draft the rest around them so the whole comes to 30 to 40 slots:\n\n${JSON.stringify(kept.map(slotForPrompt), null, 2)}`,
    )
  }
  if (note) parts.push(`His note on what should change since the last draft: ${note}`)
  parts.push(kept.length > 0 ? 'Draft the remaining slots.' : 'Draft his blueprint.')
  return [{ role: 'user', content: parts.join('\n\n') }]
}

export function buildRefillMessages(
  profile: Profile,
  guide: Guide,
  retired: Slot,
  others: Slot[],
  note: string | null,
): Anthropic.Beta.BetaMessageParam[] {
  const parts = [
    `His profile:\n\n${JSON.stringify(profileBrief(profile), null, 2)}`,
    `His style guide:\n\n${JSON.stringify(guideForPrompt(guide), null, 2)}`,
    `The rest of his blueprint:\n\n${JSON.stringify(others.map(slotForPrompt), null, 2)}`,
    `The slot he retired:\n\n${JSON.stringify(slotForPrompt(retired), null, 2)}`,
  ]
  if (note) parts.push(`His note: ${note}`)
  parts.push('Propose the slot that takes its place.')
  return [{ role: 'user', content: parts.join('\n\n') }]
}

export async function draftSlots(
  profile: Profile,
  guide: Guide,
  kept: Slot[],
  note: string | null,
): Promise<{ slots: SlotDraft[]; meta: GenerationMeta }> {
  const { data, meta } = await generate({
    schema: BlueprintSchema,
    system: BLUEPRINT_SYSTEM_PROMPT,
    messages: buildDraftMessages(profile, guide, kept, note),
    maxTokens: 64000,
    what: 'blueprint',
  })
  const slots = data.slots.map((slot) => tidyDraft(slot, guide, profile))
  if (slots.length === 0) throw new BlueprintError('Claude returned an empty blueprint. Try again.')
  return { slots: sortDrafts(slots), meta }
}

export async function draftRefill(
  profile: Profile,
  guide: Guide,
  retired: Slot,
  others: Slot[],
  note: string | null,
): Promise<{ slot: SlotDraft; meta: GenerationMeta }> {
  const { data, meta } = await generate({
    schema: RefillSchema,
    system: REFILL_SYSTEM_PROMPT,
    messages: buildRefillMessages(profile, guide, retired, others, note),
    maxTokens: 16000,
    what: 'refill',
  })
  return { slot: tidyDraft(data.slot, guide, profile), meta }
}

/**
 * Holds Claude to the rules the prompt states, so a slip never reaches the
 * finder: colours tidied and kept only if the guide has them (falling back to
 * any valid hex rather than none), the band ordered, and the maximum held
 * under the category ceiling when one is set.
 */
export function tidyDraft(slot: SlotDraft, guide: Pick<Guide, 'palette'>, profile: Pick<Profile, 'budget'>): SlotDraft {
  const palette = new Set(guideColours(guide).map((colour) => colour.hex))
  const valid = slot.colours.flatMap((value) => {
    const hex = normaliseHex(value)
    return hex ? [hex] : []
  })
  const inPalette = valid.filter((hex) => palette.has(hex))
  const colours = [...new Set(inPalette.length > 0 ? inPalette : valid)].slice(0, 3)

  let { min, max } = slot.budget_nzd
  if (min > max) [min, max] = [max, min]
  const ceiling = profile.budget[BUDGET_CATEGORY[slot.garment_type]]
  if (typeof ceiling === 'number' && ceiling > 0 && max > ceiling) {
    max = ceiling
    min = Math.min(min, max)
  }

  return {
    ...slot,
    name: sentenceCase(slot.name.trim()),
    why: sentenceCase(slot.why.trim()),
    colours,
    fabrics: slot.fabrics.map((fabric) => fabric.trim()).filter(Boolean),
    fit: slot.fit,
    sizes: { labels: slot.sizes.labels.map((label) => label.trim()).filter(Boolean), note: slot.sizes.note?.trim() || null },
    budget_nzd: { min, max },
  }
}

/** "ecru crew tee" -> "Ecru crew tee". Leaves the rest alone, so "OCBD" stays. */
export function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Priority, then the order Claude gave within it. */
export function sortDrafts(slots: SlotDraft[]): SlotDraft[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => a.slot.priority - b.slot.priority || a.index - b.index)
    .map(({ slot }) => slot)
}

/**
 * On a redraft, which slots survive: anything Malin wrote or edited, and
 * anything owned or with a candidate. The rest (Claude's untouched wanted and
 * retired slots) is replaced.
 */
export function isKeptOnRedraft(slot: Pick<Slot, 'source' | 'edited_at' | 'status'>): boolean {
  return slot.source === 'malin' || slot.edited_at !== null || slot.status === 'owned' || slot.status === 'candidate'
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function cents(nzd: number | null): number | null {
  return nzd === null ? null : Math.round(nzd * 100)
}

export function dollars(value: number | null): number | null {
  return value === null ? null : Math.round(value / 100)
}

const SELECT = (sql: ReturnType<typeof db>) => sql`
  select s.id::int as id, s.position, s.name, s.why, s.priority::int as priority, s.garment_type,
         s.colour_family, s.colours, s.fabrics, s.fit, s.sizes,
         s.budget_min_cents, s.budget_max_cents, s.status, s.source, s.edited_at,
         s.replaces_id::int as replaces_id,
         (select r.id::int from blueprint_slots r where r.replaces_id = s.id) as refilled_by
  from blueprint_slots s
`

export async function listSlots(): Promise<Slot[]> {
  const sql = db()
  return sql<Slot[]>`${SELECT(sql)} order by s.priority, s.position, s.id`
}

export async function getSlot(id: number): Promise<Slot | null> {
  const sql = db()
  const [slot] = await sql<Slot[]>`${SELECT(sql)} where s.id = ${id}`
  return slot ?? null
}

function insertRow(slot: SlotDraft, position: number, source: 'claude' | 'malin', replacesId: number | null = null) {
  return {
    position,
    name: slot.name,
    why: slot.why,
    priority: slot.priority,
    garment_type: slot.garment_type,
    colour_family: slot.colour_family || null,
    colours: slot.colours,
    fabrics: slot.fabrics,
    fit: slot.fit,
    sizes: db().json(slot.sizes),
    budget_min_cents: cents(slot.budget_nzd.min),
    budget_max_cents: cents(slot.budget_nzd.max),
    status: slot.status,
    source,
    replaces_id: replacesId,
  }
}

/**
 * Swap Claude's replaceable slots for a new draft in one transaction, so a
 * failure leaves the old blueprint intact. New slots go after the kept ones.
 */
export async function replaceDraft(drafts: SlotDraft[]): Promise<void> {
  await db().begin(async (sql) => {
    const existing = await sql<Slot[]>`select id::int as id, source, edited_at, status from blueprint_slots`
    const replace = existing.filter((slot) => !isKeptOnRedraft(slot)).map((slot) => slot.id)
    if (replace.length > 0) await sql`delete from blueprint_slots where id in ${sql(replace)}`
    const [{ max } = { max: 0 }] = await sql<{ max: number }[]>`
      select coalesce(max(position), 0)::int as max from blueprint_slots
    `
    for (const [index, draft] of drafts.entries()) {
      const row = insertRow(draft, max + index + 1, 'claude')
      await sql`insert into blueprint_slots ${sql(row)}`
    }
    // A staple he listed as owned is drafted owned, so it is a piece too.
    await syncSlotPieces(sql)
  })
}

/** The refill sits right after the slot it replaces. */
export async function insertRefill(retired: Slot, draft: SlotDraft): Promise<number> {
  return db().begin(async (sql) => {
    await sql`update blueprint_slots set position = position + 1 where position > ${retired.position}`
    const row = insertRow(draft, retired.position + 1, 'claude', retired.id)
    const [inserted] = await sql<{ id: number }[]>`insert into blueprint_slots ${sql(row)} returning id::int as id`
    if (!inserted) throw new Error('refill insert returned nothing')
    await syncSlotPieces(sql)
    return inserted.id
  })
}

export type SlotValues = {
  name: string
  why: string
  priority: Priority
  garment_type: GarmentType
  colour_family: string | null
  colours: string[]
  fabrics: string[]
  fit: Fit | null
  size_labels: string[]
  size_note: string | null
  budget_min: number | null
  budget_max: number | null
  /** Set from the add form; the edit page changes status on its own, so an edit leaves it alone. */
  status: SlotStatus | null
}

function valuesRow(values: SlotValues) {
  return {
    name: values.name,
    why: values.why,
    priority: values.priority,
    garment_type: values.garment_type,
    colour_family: values.colour_family,
    colours: values.colours,
    fabrics: values.fabrics,
    fit: values.fit,
    sizes: db().json({ labels: values.size_labels, note: values.size_note }),
    budget_min_cents: cents(values.budget_min),
    budget_max_cents: cents(values.budget_max),
    ...(values.status ? { status: values.status } : {}),
  }
}

/** A slot Malin added himself goes to the end of its priority. */
export async function createSlot(values: SlotValues): Promise<number> {
  return db().begin(async (sql) => {
    const [{ max } = { max: 0 }] = await sql<{ max: number }[]>`
      select coalesce(max(position), 0)::int as max from blueprint_slots
    `
    const row = { ...valuesRow(values), status: values.status ?? 'wanted', position: max + 1, source: 'malin' }
    const [inserted] = await sql<{ id: number }[]>`insert into blueprint_slots ${sql(row)} returning id::int as id`
    if (!inserted) throw new Error('slot insert returned nothing')
    // "I already own this" makes it a piece in the wardrobe.
    await syncSlotPieces(sql)
    return inserted.id
  })
}

/** An edit marks the slot as Malin's, so a redraft keeps it. Changing priority moves it to the end of the new group. */
export async function updateSlot(id: number, values: SlotValues): Promise<void> {
  await db().begin(async (sql) => {
    const [current] = await sql<{ priority: number }[]>`select priority::int as priority from blueprint_slots where id = ${id}`
    if (!current) return
    const row = { ...valuesRow(values), edited_at: new Date() }
    await sql`update blueprint_slots set ${sql(row)} where id = ${id}`
    if (current.priority !== values.priority) {
      await sql`
        update blueprint_slots
        set position = (select coalesce(max(position), 0) + 1 from blueprint_slots)
        where id = ${id}
      `
    }
  })
}

/** Owned brings a piece into the wardrobe; leaving owned lets it go (see syncSlotPieces). */
export async function setSlotStatus(id: number, status: SlotStatus): Promise<void> {
  await db().begin(async (sql) => {
    await sql`update blueprint_slots set status = ${status} where id = ${id}`
    await syncSlotPieces(sql)
  })
}

export async function deleteSlot(id: number): Promise<void> {
  await db()`delete from blueprint_slots where id = ${id}`
}

/**
 * Swap a slot with its neighbour in the same priority. Retired slots sit in a
 * group of their own on the page, so they are not neighbours of anything.
 */
export async function moveSlot(id: number, direction: 'up' | 'down'): Promise<void> {
  await db().begin(async (sql) => {
    const [slot] = await sql<{ id: number; position: number; priority: number }[]>`
      select id::int as id, position, priority::int as priority from blueprint_slots
      where id = ${id} and status <> 'retired'
    `
    if (!slot) return
    const [neighbour] =
      direction === 'up'
        ? await sql<{ id: number; position: number }[]>`
            select id::int as id, position from blueprint_slots
            where priority = ${slot.priority} and status <> 'retired'
              and (position < ${slot.position} or (position = ${slot.position} and id < ${slot.id}))
            order by position desc, id desc limit 1`
        : await sql<{ id: number; position: number }[]>`
            select id::int as id, position from blueprint_slots
            where priority = ${slot.priority} and status <> 'retired'
              and (position > ${slot.position} or (position = ${slot.position} and id > ${slot.id}))
            order by position, id limit 1`
    if (!neighbour) return
    // Equal positions would make the swap a no-op, so separate them first.
    const [a, b] = neighbour.position === slot.position
      ? direction === 'up' ? [slot.position, slot.position + 1] : [slot.position + 1, slot.position]
      : [neighbour.position, slot.position]
    await sql`update blueprint_slots set position = ${a} where id = ${slot.id}`
    await sql`update blueprint_slots set position = ${b} where id = ${neighbour.id}`
  })
}

// ---------------------------------------------------------------------------
// The slot form, shared by "add your own" and edit.
// ---------------------------------------------------------------------------

const nzd = z.number().int('Whole dollars').min(0).max(100_000).nullable()

export const SlotFormSchema = z
  .object({
    name: z.string().min(1).max(120),
    why: z.string().min(1).max(600),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    garment_type: z.enum(GARMENT_TYPES),
    colour_family: z.string().max(60).nullable(),
    colours: z.array(z.string()).max(3),
    fabrics: z.array(z.string().max(40)).max(6),
    fit: z.enum(FITS).nullable(),
    size_labels: z.array(z.string().max(20)).max(8),
    size_note: z.string().max(400).nullable(),
    budget_min: nzd,
    budget_max: nzd,
    status: z.enum(SLOT_STATUSES).nullable(),
  })
  .refine((v) => v.budget_min === null || v.budget_max === null || v.budget_min <= v.budget_max, {
    path: ['budget_max'],
    message: 'At least the lower figure',
  })

export function parseSlotForm(form: FormData): ParseResult<SlotValues> {
  const priority = number(form, 'priority')
  const colours = form
    .getAll('colours')
    .flatMap((value) => (typeof value === 'string' ? [normaliseHex(value)] : []))
    .filter((value): value is string => value !== null)
  return finish(SlotFormSchema, {
    name: text(form, 'name') ?? '',
    why: text(form, 'why') ?? '',
    priority,
    garment_type: text(form, 'garment_type'),
    colour_family: text(form, 'colour_family'),
    colours: [...new Set(colours)],
    fabrics: list(form, 'fabrics'),
    fit: text(form, 'fit'),
    size_labels: list(form, 'size_labels'),
    size_note: text(form, 'size_note'),
    budget_min: number(form, 'budget_min'),
    budget_max: number(form, 'budget_max'),
    status: text(form, 'status'),
  }) as ParseResult<SlotValues>
}
