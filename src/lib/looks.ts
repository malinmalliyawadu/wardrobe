import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { MODELS, callUsd } from './claude.ts'
import { db, type Sql } from './db.ts'
import { inPalette, listPieces, type Piece } from './pieces.ts'
import type { Profile } from './profile.ts'
import { generate, type GenerationMeta } from './structured.ts'
import { colourNameFor, profileBrief, type Guide } from './style-guide.ts'
import type { GarmentType, SlotStatus } from './wardrobe-values.ts'

/*
 * Looks (migration 0007): outfits Opus puts together from the pieces he owns,
 * against his style guide, proportions, week and Wellington's weather. Made
 * on his tap, six at a time. Claude is sent the pieces' words, never their
 * photos. Code holds the result to what a look must be (tidyLooks): only
 * pieces he has, each once, one pair of trousers, one pair of shoes, at least
 * one top; a look that fails is dropped, never shown half right.
 */

export const OCCASIONS = ['office', 'weekend', 'evening', 'travel'] as const
export type Occasion = (typeof OCCASIONS)[number]

export const OCCASION_LABELS: Record<Occasion, string> = {
  office: 'Office',
  weekend: 'Weekend',
  evening: 'Evening out',
  travel: 'Travel',
}

export const LOOK_DISMISS_REASONS = ['colours', 'too_dressy', 'too_casual', 'weather', 'not_me'] as const
export type LookDismissReason = (typeof LOOK_DISMISS_REASONS)[number]

export const LOOK_REASON_LABELS: Record<LookDismissReason, string> = {
  colours: 'Colours',
  too_dressy: 'Too dressy',
  too_casual: 'Too casual',
  weather: 'Wrong for the weather',
  not_me: 'Not me',
}

export const LOOKS_PER_SET = 6

// ---------------------------------------------------------------------------
// What a look is made of
// ---------------------------------------------------------------------------

/** Outermost layer first, then down the body, then what is carried. A look's pieces are shown in this order. */
const LAYER_ORDER: GarmentType[] = [
  'coat', 'jacket', 'tailoring', 'overshirt', 'knitwear', 'sweatshirt', 'shirt', 'polo', 'tee',
  'trousers', 'jeans', 'shorts', 'boots', 'shoes', 'sneakers', 'accessory', 'bag',
]

const TOPS: GarmentType[] = ['tee', 'polo', 'shirt', 'knitwear', 'sweatshirt', 'overshirt']
const BOTTOMS: GarmentType[] = ['trousers', 'jeans', 'shorts']
const FOOTWEAR: GarmentType[] = ['boots', 'shoes', 'sneakers']
const OUTER: GarmentType[] = ['coat', 'jacket']
const CARRIED: GarmentType[] = ['accessory', 'bag']

export type Readiness = { ready: boolean; missing: string[] }

/** Enough to dress him: two tops, a pair of trousers and a pair of shoes. */
export function readiness(pieces: Pick<Piece, 'garment_type' | 'set_aside_at'>[]): Readiness {
  const active = pieces.filter((piece) => !piece.set_aside_at)
  const count = (types: GarmentType[]) => active.filter((piece) => types.includes(piece.garment_type)).length
  const missing: string[] = []
  const tops = count(TOPS)
  if (tops < 2) missing.push(tops === 0 ? 'two tops' : 'one more top')
  if (count(BOTTOMS) === 0) missing.push('a pair of trousers or jeans')
  if (count(FOOTWEAR) === 0) missing.push('a pair of shoes')
  return { ready: missing.length === 0, missing }
}

// ---------------------------------------------------------------------------
// Claude's output format
// ---------------------------------------------------------------------------

export const LookDraftSchema = z.object({
  title: z.string().describe('A name for the look, two to five words, plain, no puns: "Navy and putty office day".'),
  occasion: z.enum(OCCASIONS),
  weather: z
    .string()
    .describe('The Wellington day it is dressed for, a few words: "mild and still", "cold southerly with showers".'),
  piece_ids: z
    .array(z.number().int())
    .describe('Ids of the pieces it is made of, from the list only: the outermost layer first, down to the shoes, then any accessories.'),
  why: z
    .string()
    .describe('Two sentences to him: the colour story in his palette, then the proportion or fit move from his guide that makes it work.'),
  styling: z
    .string()
    .nullable()
    .describe('One short instruction for wearing it: "tuck the tee, one cuff on the jeans". Null when there is nothing to add.'),
  better_with: z
    .object({
      slot_id: z.number().int().describe('The id of one slot from his wanted list.'),
      why: z.string().describe('A few words on what it would add: "a lighter shoe would lift the navy".'),
    })
    .nullable()
    .describe('One wanted slot that would clearly lift this look, or null. Use it in at most two looks of the set.'),
})

export const LooksSchema = z.object({
  looks: z.array(LookDraftSchema).describe(`${LOOKS_PER_SET} looks, each a different outfit.`),
})

export type LookDraft = z.infer<typeof LookDraftSchema>

export const LOOKS_SYSTEM_PROMPT = `You are an experienced menswear stylist putting outfits together for one client from clothes he already owns. You have his confirmed profile (colouring, proportions, sizes, his week), the style guide written for him, the list of his pieces, and what he did with the looks you made before. A private app shows him the looks as a lookbook page; he saves the ones he likes, dismisses the rest with a reason, and logs the days he wears one.

Each look is one complete outfit he could put on today: at least one top, exactly one pair of trousers, jeans or shorts, exactly one pair of shoes, and an outer layer when the weather asks for it. Accessories only when they add something, and then in his metal. Use only the pieces on the list, by id, each piece at most once in a look; never invent a garment he does not have.

Dress him for Wellington: mild, windy, often wet, with layers year round. You are given today's date and the month's usual weather; make most looks for an ordinary day of that month and one for a colder, wetter or windier day than usual. Match warmth: a light linen shirt is not a winter look, a car coat is not a summer one.

Spread the set across his week. Weight the occasions by the days he gave for office, evenings out and the rest; where he gave nothing, assume office days, weekends and evenings out. Office means smart casual unless his profile says otherwise. Travel only when he travels.

Colour is the point. Build each look on his palette: say in the why which of his colours carry it and why they sit together (tonal, contrast near the face, a neutral base with one strong colour). Respect the proportion and fit rules in his guide, and name the one that the look uses. Respect his no-gos absolutely.

Make the set varied: no two looks share more than two pieces, and none repeats a look he saved or dismissed. Learn from the reasons he dismissed looks for. Prefer pieces he has worn less lately, so the whole wardrobe gets used. When a look would clearly be better with one of the slots he still wants, say so in better_with, in at most two looks; otherwise leave it null.

Write to him in the second person, plainly, without praise or sales talk. Plain hyphens only.`

// ---------------------------------------------------------------------------
// Wellington
// ---------------------------------------------------------------------------

/** Wellington's usual daily highs and lows by month, in degrees Celsius (rounded long-term averages). */
const WELLINGTON: { high: number; low: number }[] = [
  { high: 21, low: 14 }, { high: 21, low: 14 }, { high: 19, low: 13 }, { high: 17, low: 11 },
  { high: 15, low: 9 }, { high: 13, low: 7 }, { high: 12, low: 6 }, { high: 12, low: 7 },
  { high: 14, low: 8 }, { high: 15, low: 9 }, { high: 17, low: 11 }, { high: 19, low: 13 },
]

/** Today in New Zealand, and the month's usual weather, for the prompt and the set's record. */
export function wellingtonToday(now: Date = new Date()): { date: string; month: string; weather: string } {
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const month = now.toLocaleDateString('en-NZ', { month: 'long', timeZone: 'Pacific/Auckland' })
  const index = Number(date.slice(5, 7)) - 1
  const { high, low } = WELLINGTON[index]!
  return { date, month, weather: `Wellington in ${month}: usually ${low} to ${high} degrees, often windy, showers likely` }
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export type WantedSlot = { id: number; name: string; garment_type: GarmentType; status: SlotStatus }

export type History = {
  saved: { title: string; piece_ids: number[] }[]
  dismissed: { title: string; piece_ids: number[]; reason: LookDismissReason }[]
  /** How many times each piece was in a look he wore in the last three weeks. */
  worn: Map<number, number>
}

function pieceForPrompt(piece: Piece, guide: Pick<Guide, 'palette'> | null, worn: Map<number, number>) {
  return {
    id: piece.id,
    name: piece.name,
    garment: piece.garment_type,
    colour: piece.colour_hex
      ? {
          hex: piece.colour_hex,
          name: colourNameFor(guide, piece.colour_hex) ?? piece.colour_name,
          in_palette: inPalette(piece.colour_hex, guide),
        }
      : piece.colour_name ?? 'no single colour',
    fabric: piece.fabric,
    fit: piece.fit,
    warmth: piece.warmth,
    notes: piece.notes,
    worn_lately: worn.get(piece.id) ?? 0,
  }
}

export function buildLooksMessages(input: {
  profile: Profile
  guide: Guide
  pieces: Piece[]
  wanted: WantedSlot[]
  history: History
  note: string | null
  now?: Date
}): Anthropic.Beta.BetaMessageParam[] {
  const { date, weather } = wellingtonToday(input.now)
  const active = input.pieces.filter((piece) => !piece.set_aside_at && piece.garment_type !== 'activewear')
  const body = {
    today: date,
    usual_weather: weather,
    profile: profileBrief(input.profile),
    style_guide: {
      palette: input.guide.palette,
      silhouette: input.guide.silhouette,
      shoes: input.guide.shoes,
      accessories: input.guide.accessories,
      fit_vocabulary: input.guide.fit_vocabulary,
    },
    pieces: active.map((piece) => pieceForPrompt(piece, input.guide, input.history.worn)),
    wanted_slots: input.wanted.map((slot) => ({ id: slot.id, name: slot.name, garment: slot.garment_type })),
    looks_he_saved: input.history.saved,
    looks_he_dismissed: input.history.dismissed,
  }
  const ask = input.note
    ? `He asked for this set: "${input.note}". Make ${LOOKS_PER_SET} looks with that in mind.`
    : `Make ${LOOKS_PER_SET} looks.`
  return [{ role: 'user', content: `${JSON.stringify(body, null, 2)}\n\n${ask}` }]
}

export type LookSetDraft = { looks: (LookDraft & { piece_ids: number[] })[]; proposed: number; meta: GenerationMeta; usd: number }

export async function draftLooks(input: Parameters<typeof buildLooksMessages>[0]): Promise<LookSetDraft> {
  const { data, meta } = await generate({
    schema: LooksSchema,
    system: LOOKS_SYSTEM_PROMPT,
    messages: buildLooksMessages(input),
    maxTokens: 32000,
    what: 'looks',
    model: MODELS.looks,
  })
  const usd = callUsd(MODELS.looks, { input_tokens: meta.input_tokens, output_tokens: meta.output_tokens })
  return {
    looks: tidyLooks(data.looks, input.pieces, input.wanted, input.history),
    proposed: data.looks.length,
    meta,
    usd,
  }
}

/** The pieces as a sorted id list, to tell two looks apart. */
function signature(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(',')
}

/**
 * Holds Claude to what a look must be. Unknown or set-aside pieces and
 * repeats within a look are dropped first; then a look needs at least one
 * top, exactly one pair of trousers and one pair of shoes, at most one coat
 * or jacket and one tailored jacket, at most three things carried, and must
 * not repeat a look in the set or one he saved or dismissed. Its pieces are
 * put in layer order, and a better_with that is not one of his wanted slots
 * is dropped.
 */
export function tidyLooks(
  drafts: LookDraft[],
  pieces: Pick<Piece, 'id' | 'garment_type' | 'set_aside_at'>[],
  wanted: Pick<WantedSlot, 'id'>[],
  history: Pick<History, 'saved' | 'dismissed'>,
): (LookDraft & { piece_ids: number[] })[] {
  const byId = new Map(pieces.filter((piece) => !piece.set_aside_at && piece.garment_type !== 'activewear').map((piece) => [piece.id, piece]))
  const wantedIds = new Set(wanted.map((slot) => slot.id))
  const seen = new Set([...history.saved, ...history.dismissed].map((look) => signature(look.piece_ids)))
  const out: (LookDraft & { piece_ids: number[] })[] = []

  for (const draft of drafts) {
    const ids = [...new Set(draft.piece_ids)].filter((id) => byId.has(id))
    const types = ids.map((id) => byId.get(id)!.garment_type)
    const count = (group: GarmentType[]) => types.filter((type) => group.includes(type)).length
    const valid =
      count(TOPS) >= 1 &&
      count(BOTTOMS) === 1 &&
      count(FOOTWEAR) === 1 &&
      count(OUTER) <= 1 &&
      count(['tailoring']) <= 1 &&
      count(CARRIED) <= 3 &&
      ids.length >= 3 &&
      ids.length <= 8
    if (!valid) continue
    const key = signature(ids)
    if (seen.has(key)) continue
    seen.add(key)
    const ordered = [...ids].sort(
      (a, b) => LAYER_ORDER.indexOf(byId.get(a)!.garment_type) - LAYER_ORDER.indexOf(byId.get(b)!.garment_type),
    )
    out.push({
      ...draft,
      title: draft.title.trim(),
      piece_ids: ordered,
      better_with: draft.better_with && wantedIds.has(draft.better_with.slot_id) ? draft.better_with : null,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function readHistory(sql: Sql = db()): Promise<History> {
  const looks = await sql<{ title: string; status: 'saved' | 'dismissed'; reason: LookDismissReason | null; piece_ids: number[] }[]>`
    select l.title, l.status, l.dismiss_reason as reason,
           array(select lp.piece_id::int from look_pieces lp where lp.look_id = l.id order by lp.position) as piece_ids
    from looks l
    where l.status = 'saved' or (l.status = 'dismissed' and l.acted_at > now() - interval '90 days')
    order by l.acted_at desc
    limit 60
  `
  const worn = await sql<{ piece_id: number; count: number }[]>`
    select lp.piece_id::int as piece_id, count(*)::int as count
    from look_wears w join look_pieces lp on lp.look_id = w.look_id
    where w.worn_on > (now() at time zone 'Pacific/Auckland')::date - 21
    group by lp.piece_id
  `
  return {
    saved: looks.filter((look) => look.status === 'saved').map(({ title, piece_ids }) => ({ title, piece_ids })),
    dismissed: looks
      .filter((look) => look.status === 'dismissed' && look.reason)
      .map(({ title, piece_ids, reason }) => ({ title, piece_ids, reason: reason! })),
    worn: new Map(worn.map((row) => [row.piece_id, row.count])),
  }
}

export async function wantedSlots(sql: Sql = db()): Promise<WantedSlot[]> {
  return sql<WantedSlot[]>`
    select id::int as id, name, garment_type, status from blueprint_slots
    where status in ('wanted', 'candidate') order by priority, position, id
  `
}

export async function saveSet(
  draft: LookSetDraft,
  context: { note: string | null; pieces: number; date: string; weather: string },
  sql: Sql = db(),
): Promise<number> {
  return sql.begin(async (tx) => {
    const [set] = await tx<{ id: number }[]>`
      insert into look_sets ${tx({
        note: context.note,
        context: tx.json({ date: context.date, weather: context.weather, pieces: context.pieces }),
        model: draft.meta.model,
        served_by: draft.meta.served_by,
        input_tokens: draft.meta.input_tokens,
        output_tokens: draft.meta.output_tokens,
        usd: Number(draft.usd.toFixed(6)),
        proposed: draft.proposed,
      })}
      returning id::int as id
    `
    if (!set) throw new Error('set insert returned nothing')
    for (const [position, look] of draft.looks.entries()) {
      const [row] = await tx<{ id: number }[]>`
        insert into looks ${tx({
          set_id: set.id,
          position,
          title: look.title,
          occasion: look.occasion,
          weather: look.weather,
          why: look.why,
          styling: look.styling,
          better_slot_id: look.better_with?.slot_id ?? null,
          better_why: look.better_with?.why ?? null,
          piece_count: look.piece_ids.length,
        })}
        returning id::int as id
      `
      await tx`
        insert into look_pieces ${tx(look.piece_ids.map((piece_id, index) => ({ look_id: row!.id, piece_id, position: index })))}
      `
    }
    return set.id
  })
}

export type Look = {
  id: number
  set_id: number
  title: string
  occasion: Occasion
  weather: string
  why: string
  styling: string | null
  better: { slot_id: number; name: string; colours: string[]; why: string | null } | null
  status: 'new' | 'saved' | 'dismissed'
  piece_count: number
  pieces: Piece[]
  /** Days he wore it, newest first, as YYYY-MM-DD in New Zealand. */
  worn: string[]
}

export type LookSet = {
  id: number
  note: string | null
  usd: number | null
  proposed: number
  pieces: number
  created_at: Date
}

export type LooksPage = {
  /** Saved from earlier sets, the most recently worn first. */
  saved: Look[]
  latest: LookSet | null
  /** The newest set, less what he dismissed. */
  fresh: Look[]
  total: { sets: number; usd: number }
}

/** The newest set's looks he has not dismissed, and the looks he saved from earlier sets. */
export async function readLooks(sql: Sql = db()): Promise<LooksPage> {
  const [latest] = await sql<LookSet[]>`
    select id::int as id, note, usd::float as usd, proposed, coalesce((context ->> 'pieces')::int, 0) as pieces, created_at
    from look_sets order by created_at desc, id desc limit 1
  `
  const [total] = await sql<{ sets: number; usd: number }[]>`
    select count(*)::int as sets, coalesce(sum(usd), 0)::float as usd from look_sets
  `
  const rows = await sql<(Omit<Look, 'pieces' | 'better' | 'worn'> & { piece_ids: number[]; better_slot_id: number | null; better_name: string | null; better_colours: string[] | null; better_why: string | null; worn: string[] })[]>`
    select l.id::int as id, l.set_id::int as set_id, l.title, l.occasion, l.weather, l.why, l.styling, l.status, l.piece_count,
           l.better_slot_id::int as better_slot_id, s.name as better_name, s.colours as better_colours, l.better_why,
           array(select lp.piece_id::int from look_pieces lp where lp.look_id = l.id order by lp.position) as piece_ids,
           array(select to_char(w.worn_on, 'YYYY-MM-DD') from look_wears w where w.look_id = l.id order by w.worn_on desc) as worn
    from looks l
    left join blueprint_slots s on s.id = l.better_slot_id and s.status in ('wanted', 'candidate')
    where l.status = 'saved' or (l.status = 'new' and l.set_id = ${latest?.id ?? 0})
    order by l.set_id = ${latest?.id ?? 0} desc, l.position, l.acted_at desc
  `
  const pieces = new Map((await listPieces(sql)).map((piece) => [piece.id, piece]))
  const looks: Look[] = rows.map((row) => ({
    id: row.id,
    set_id: row.set_id,
    title: row.title,
    occasion: row.occasion,
    weather: row.weather,
    why: row.why,
    styling: row.styling,
    status: row.status,
    piece_count: row.piece_count,
    better:
      row.better_slot_id && row.better_name
        ? { slot_id: row.better_slot_id, name: row.better_name, colours: row.better_colours ?? [], why: row.better_why }
        : null,
    pieces: row.piece_ids.flatMap((id) => (pieces.has(id) ? [pieces.get(id)!] : [])),
    worn: row.worn,
  }))
  // A look saved from the newest set stays where it is, so a tap never moves the card under his finger.
  const inLatest = (look: Look) => latest !== undefined && look.set_id === latest.id
  return {
    saved: looks.filter((look) => !inLatest(look)).sort((a, b) => (b.worn[0] ?? '').localeCompare(a.worn[0] ?? '')),
    latest: latest ?? null,
    fresh: looks.filter(inLatest),
    total: total ?? { sets: 0, usd: 0 },
  }
}

export const LookActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), look_id: z.number().int().positive() }),
  z.object({ action: z.literal('unsave'), look_id: z.number().int().positive() }),
  z.object({ action: z.literal('dismiss'), look_id: z.number().int().positive(), reason: z.enum(LOOK_DISMISS_REASONS) }),
  z.object({ action: z.literal('wore'), look_id: z.number().int().positive() }),
  z.object({ action: z.literal('unwore'), look_id: z.number().int().positive() }),
])

export type LookAction = z.infer<typeof LookActionSchema>

/**
 * Save, un-save, dismiss with a reason, and wore it today (or undo that).
 * Wearing a look he had not saved saves it: a look worn is one he likes.
 */
export async function actOnLook(input: LookAction, sql: Sql = db()): Promise<void> {
  const action = LookActionSchema.parse(input)
  const id = action.look_id
  switch (action.action) {
    case 'save':
      await sql`update looks set status = 'saved', dismiss_reason = null, acted_at = now() where id = ${id}`
      return
    case 'unsave':
      await sql`update looks set status = 'new', acted_at = now() where id = ${id} and status = 'saved'`
      return
    case 'dismiss':
      await sql`update looks set status = 'dismissed', dismiss_reason = ${action.reason}, acted_at = now() where id = ${id}`
      return
    case 'wore':
      await sql.begin(async (tx) => {
        await tx`insert into look_wears (look_id) values (${id}) on conflict do nothing`
        await tx`update looks set status = 'saved', dismiss_reason = null, acted_at = now() where id = ${id} and status <> 'saved'`
      })
      return
    case 'unwore':
      await sql`delete from look_wears where look_id = ${id} and worn_on = (now() at time zone 'Pacific/Auckland')::date`
      return
  }
}

/** Today in New Zealand as YYYY-MM-DD, to tell whether a look was worn today. */
export function todayNz(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}
