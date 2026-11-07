import type Anthropic from '@anthropic-ai/sdk'
import type postgres from 'postgres'
import { z } from 'zod'

import { MODELS, callUsd } from './claude.ts'
import { db, type Sql } from './db.ts'
import { BOTTOMS, FOOTWEAR, isWhole, LAYER_ORDER, TOPS } from './look-rules.ts'
import { inPalette, listPieces, type Piece } from './pieces.ts'
import type { Profile } from './profile.ts'
import { generate, type GenerationMeta } from './structured.ts'
import { colourNameFor, getGuide, profileBrief, type Guide } from './style-guide.ts'
import { latestLookTryOns, type OnMe } from './try-on.ts'
import { limitForPrompt, pieceWarmth, WARMTH_RULES, warmthLimit } from './warmth.ts'
import { forEveryday, forGym, type GarmentType, type SlotStatus } from './wardrobe-values.ts'

/*
 * Looks (migration 0007): outfits Opus puts together from the pieces he owns,
 * against his style guide, proportions, week and Wellington's weather. Made
 * on his tap, six at a time. Claude is sent the pieces' words, never their
 * photos. Code holds the result to what a look must be (tidyLooks): only
 * pieces he has, each once, one pair of trousers, one pair of shoes, at least
 * one top; a look that fails is dropped, never shown half right.
 *
 * Gym fits (migration 0014) are looks of the gym occasion, made only from
 * pieces worn for the gym or both; every other look leaves gym-only kit out.
 *
 * Looks around a piece (migration 0018) are a set of their own kind, made on
 * a tap on that piece's page: a few looks that each wear it, from the rest of
 * what he owns. Code keeps only the ones that do.
 */

export const OCCASIONS = ['office', 'weekend', 'evening', 'travel', 'gym'] as const
export type Occasion = (typeof OCCASIONS)[number]

export const OCCASION_LABELS: Record<Occasion, string> = {
  office: 'Office',
  weekend: 'Weekend',
  evening: 'Evening out',
  travel: 'Travel',
  gym: 'Gym',
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

/** How many looks a tap on a piece's page asks for: a few ways to wear it. */
export const LOOKS_AROUND_A_PIECE = 3

// ---------------------------------------------------------------------------
// What a look is made of
// ---------------------------------------------------------------------------

export type Readiness = { ready: boolean; missing: string[] }

type Shelved = Pick<Piece, 'garment_type' | 'set_aside_at' | 'worn_for'>

/** Enough to dress him: two tops, a pair of trousers and a pair of shoes, gym kit aside. */
export function readiness(pieces: Shelved[]): Readiness {
  const active = pieces.filter((piece) => !piece.set_aside_at && forEveryday(piece))
  const count = (types: GarmentType[]) => active.filter((piece) => types.includes(piece.garment_type)).length
  const missing: string[] = []
  const tops = count(TOPS)
  if (tops < 2) missing.push(tops === 0 ? 'two tops' : 'one more top')
  if (count(BOTTOMS) === 0) missing.push('a pair of trousers or jeans')
  if (count(FOOTWEAR) === 0) missing.push('a pair of shoes')
  return { ready: missing.length === 0, missing }
}

/**
 * Enough for a gym fit: a top, shorts or trousers, and shoes, among the
 * pieces worn for the gym or both. A piece still filed as activewear says
 * nothing about what it is, so it does not count until he names it.
 */
export function gymReadiness(pieces: Shelved[]): Readiness {
  const kit = pieces.filter((piece) => !piece.set_aside_at && forGym(piece) && piece.garment_type !== 'activewear')
  const has = (types: GarmentType[]) => kit.some((piece) => types.includes(piece.garment_type))
  const missing: string[] = []
  if (!has(TOPS)) missing.push('a top')
  if (!has(BOTTOMS)) missing.push('shorts or joggers')
  if (!has(FOOTWEAR)) missing.push('trainers')
  return { ready: missing.length === 0, missing }
}

/**
 * Enough to build looks on one piece: whole outfits of what it is worn for,
 * the piece among them. Gym-only kit needs a gym fit's worth; a piece worn
 * for both is ready when either is.
 */
export function readinessAround(piece: Pick<Piece, 'worn_for'>, pieces: Shelved[]): Readiness & { gym: boolean } {
  const everyday = readiness(pieces)
  const gym = gymReadiness(pieces)
  if (piece.worn_for === 'gym') return { ...gym, gym: true }
  if (piece.worn_for === 'both' && gym.ready) return { ...gym, gym: true }
  return { ...everyday, gym: false }
}

/** The pieces Claude may dress him in: in the wardrobe and named for what they are. */
export function dressable<T extends Pick<Piece, 'garment_type' | 'set_aside_at'>>(pieces: T[]): T[] {
  return pieces.filter((piece) => !piece.set_aside_at && piece.garment_type !== 'activewear')
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

export const PieceLooksSchema = z.object({
  looks: z
    .array(LookDraftSchema)
    .describe(`${LOOKS_AROUND_A_PIECE} looks, each wearing the piece he chose, each a different outfit around it.`),
})

export type LookDraft = z.infer<typeof LookDraftSchema>

/** What a gym fit is, for both the looks and the outfit of the day. */
export const GYM_FIT_RULES = `Each piece says what it is worn for: everyday, gym, or both. An everyday look uses only everyday and both pieces. A gym fit (occasion gym) is what he trains in and wears there: only gym and both pieces, at least one top, exactly one pair of shorts or trousers, exactly one pair of shoes, and a layer for the walk there when the day is cold, windy or wet, if he has one. Colour still counts in a gym fit: build it on his palette like any look (tonal, or one strong colour on a neutral) and say so in the why; its fit move is about moving well and what the cut shows. Nothing carried but a cap or a bag. Its styling, when there is any, is for the gym: "sleeves pushed up, the hoodie off once warm".`

export const LOOKS_SYSTEM_PROMPT = `You are an experienced menswear stylist putting outfits together for one client from clothes he already owns. You have his confirmed profile (colouring, proportions, sizes, his week), the style guide written for him, the list of his pieces, and what he did with the looks you made before. A private app shows him the looks as a lookbook page; he saves the ones he likes, dismisses the rest with a reason, and logs the days he wears one.

Each look is one complete outfit he could put on today: at least one top, exactly one pair of trousers, jeans or shorts, exactly one pair of shoes, and an outer layer when the weather asks for it. Accessories only when they add something, and then in his metal. Use only the pieces on the list, by id, each piece at most once in a look; never invent a garment he does not have.

${GYM_FIT_RULES} Make gym fits only when his gym kit is ready (gym.kit_ready). In a set for his week, make one gym fit when he trains up to three days a week and two when he trains more, and none when he gave no gym days. When he asks for gym fits, every look is one; his kit is small, so they may share pieces, but no two are the same.

Dress him for Wellington in the month you are given. You have its usual weather and warmth_limit, read from the month's usual high: make most looks for an ordinary day of that month, within that limit, and one for a colder, wetter or windier day than usual, which may go past it. ${WARMTH_RULES} Match warmth: a light linen shirt is not a winter look, a wool knit and a jacket are not a summer one.

Spread the set across his week. Weight the occasions by the days he gave for office, the gym, evenings out and the rest; where he gave nothing, assume office days, weekends and evenings out. Office means smart casual unless his profile says otherwise. Travel only when he travels.

Colour is the point. Build each look on his palette: say in the why which of his colours carry it and why they sit together (tonal, contrast near the face, a neutral base with one strong colour). Respect the proportion and fit rules in his guide, and name the one that the look uses. Respect his no-gos absolutely.

Make the set varied: no two everyday looks share more than two pieces, and none repeats a look he saved or dismissed. Learn from the reasons he dismissed looks for. Prefer pieces he has worn less lately, so the whole wardrobe gets used. When a look would clearly be better with one of the slots he still wants, say so in better_with, in at most two looks; otherwise leave it null.

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
export function wellingtonToday(now: Date = new Date()): { date: string; month: string; weather: string; high: number } {
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const month = now.toLocaleDateString('en-NZ', { month: 'long', timeZone: 'Pacific/Auckland' })
  const index = Number(date.slice(5, 7)) - 1
  const { high, low } = WELLINGTON[index]!
  return { date, month, high, weather: `Wellington in ${month}: usually ${low} to ${high} degrees, often windy, showers likely` }
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

export function pieceForPrompt(piece: Piece, guide: Pick<Guide, 'palette'> | null, worn: Map<number, number>) {
  return {
    id: piece.id,
    name: piece.name,
    garment: piece.garment_type,
    worn_for: piece.worn_for,
    colour: piece.colour_hex
      ? {
          hex: piece.colour_hex,
          name: colourNameFor(guide, piece.colour_hex) ?? piece.colour_name,
          in_palette: inPalette(piece.colour_hex, guide),
        }
      : piece.colour_name ?? 'no single colour',
    fabric: piece.fabric,
    fit: piece.fit,
    warmth: pieceWarmth(piece),
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
  /** A set for his week, or gym fits only. */
  kind?: LookKind
  /** The piece he chose on its page: every look wears it. */
  around?: Pick<Piece, 'id' | 'name' | 'worn_for'>
  now?: Date
}): Anthropic.Beta.BetaMessageParam[] {
  const { date, weather, high } = wellingtonToday(input.now)
  const body = {
    today: date,
    usual_weather: weather,
    warmth_limit: limitForPrompt(warmthLimit(high), `the month's usual high, ${high}°`),
    profile: profileBrief(input.profile),
    gym: gymForPrompt(input.profile, input.pieces),
    style_guide: {
      palette: input.guide.palette,
      silhouette: input.guide.silhouette,
      shoes: input.guide.shoes,
      accessories: input.guide.accessories,
      fit_vocabulary: input.guide.fit_vocabulary,
    },
    pieces: dressable(input.pieces).map((piece) => pieceForPrompt(piece, input.guide, input.history.worn)),
    wanted_slots: input.wanted.map((slot) => ({ id: slot.id, name: slot.name, garment: slot.garment_type })),
    looks_he_saved: input.history.saved,
    looks_he_dismissed: input.history.dismissed,
  }
  const what =
    input.kind === 'gym'
      ? `up to ${LOOKS_PER_SET} gym fits from his gym kit, fewer if it cannot make that many that differ`
      : `${LOOKS_PER_SET} looks`
  const ask = input.around
    ? aroundAsk(input.around, input.note)
    : input.note
      ? `He asked for this set: "${input.note}". Make ${what} with that in mind.`
      : `Make ${what}.`
  return [{ role: 'user', content: `${JSON.stringify(body, null, 2)}\n\n${ask}` }]
}

/** The ask for looks around one piece: a few different ways to wear it, each a whole outfit. */
function aroundAsk(piece: Pick<Piece, 'id' | 'name' | 'worn_for'>, note: string | null): string {
  const n = LOOKS_AROUND_A_PIECE
  const kind =
    piece.worn_for === 'gym'
      ? ' It is gym kit, so they are gym fits.'
      : piece.worn_for === 'both'
        ? ' He wears it to the gym and every day, so one may be a gym fit if his kit is ready.'
        : ''
  return [
    `He chose one of his pieces to build on: "${piece.name}" (id ${piece.id}).`,
    `Make ${n} looks that each wear it: ${n} different ways to wear it, for the occasions and days it suits best, each a whole outfit around it.`,
    `Apart from it, no two of the looks share more than one piece. Make fewer if the rest of his wardrobe cannot make ${n} that differ.${kind}`,
    note ? `He added: "${note}". Make them with that in mind.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export const LOOK_KINDS = ['week', 'gym'] as const
export type LookKind = (typeof LOOK_KINDS)[number]

/** How often he trains and whether his kit makes a gym fit, for the prompts. */
export function gymForPrompt(profile: Pick<Profile, 'life'>, pieces: Shelved[]) {
  const kit = gymReadiness(pieces)
  return {
    days_a_week: profile.life.gym_days?.length || profile.life.gym || 0,
    days: profile.life.gym_days ?? null,
    kit_ready: kit.ready,
    ...(kit.ready ? {} : { kit_missing: kit.missing }),
  }
}

export type LookSetDraft = { looks: (LookDraft & { piece_ids: number[] })[]; proposed: number; meta: GenerationMeta; usd: number }

export async function draftLooks(input: Parameters<typeof buildLooksMessages>[0]): Promise<LookSetDraft> {
  const gymOnly = input.around ? input.around.worn_for === 'gym' : input.kind === 'gym'
  const { data, meta } = await generate({
    schema: input.around ? PieceLooksSchema : LooksSchema,
    system: LOOKS_SYSTEM_PROMPT,
    messages: buildLooksMessages(input),
    maxTokens: 32000,
    what: 'looks',
    model: MODELS.looks,
  })
  const usd = callUsd(MODELS.looks, { input_tokens: meta.input_tokens, output_tokens: meta.output_tokens })
  const drafts = gymOnly ? data.looks.map((look) => ({ ...look, occasion: 'gym' as const })) : data.looks
  return {
    looks: tidyAround(tidyLooks(drafts, input.pieces, input.wanted, input.history), input.around?.id ?? null),
    proposed: data.looks.length,
    meta,
    usd,
  }
}

/** Looks around a piece keep only the ones that still wear it once tidied, at most the few asked for. */
export function tidyAround<T extends Pick<LookDraft, 'piece_ids'>>(looks: T[], pieceId: number | null): T[] {
  if (pieceId === null) return looks
  return looks.filter((look) => look.piece_ids.includes(pieceId)).slice(0, LOOKS_AROUND_A_PIECE)
}

/** The pieces as a sorted id list, to tell two looks apart. */
export function signature(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(',')
}

/**
 * Holds Claude to what a look must be. Unknown or set-aside pieces, pieces
 * not worn for its occasion (gym kit in an everyday look, everyday clothes in
 * a gym fit) and repeats within a look are dropped first; then a look needs at least one
 * top, exactly one pair of trousers and one pair of shoes, at most one coat
 * or jacket and one tailored jacket, at most three things carried, and must
 * not repeat a look in the set or one he saved or dismissed. Its pieces are
 * put in layer order, and a better_with that is not one of his wanted slots
 * is dropped.
 */
export function tidyLooks<T extends LookDraft>(
  drafts: T[],
  pieces: Pick<Piece, 'id' | 'garment_type' | 'set_aside_at' | 'worn_for'>[],
  wanted: Pick<WantedSlot, 'id'>[],
  history: Pick<History, 'saved' | 'dismissed'>,
): T[] {
  const byId = new Map(dressable(pieces).map((piece) => [piece.id, piece]))
  const wantedIds = new Set(wanted.map((slot) => slot.id))
  const seen = new Set([...history.saved, ...history.dismissed].map((look) => signature(look.piece_ids)))
  const out: T[] = []

  for (const draft of drafts) {
    const wornFor = draft.occasion === 'gym' ? forGym : forEveryday
    const ids = [...new Set(draft.piece_ids)].filter((id) => byId.has(id) && wornFor(byId.get(id)!))
    if (!isWhole(ids.map((id) => byId.get(id)!.garment_type))) continue
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
  context: {
    note: string | null
    pieces: number
    date: string
    weather: string
    kind?: LookKind
    /** The piece a set of looks around a piece was made on. */
    pieceId?: number
  },
  sql: Sql = db(),
): Promise<number> {
  return sql.begin(async (tx) => {
    const [set] = await tx<{ id: number }[]>`
      insert into look_sets ${tx({
        kind: context.pieceId ? 'piece' : 'set',
        piece_id: context.pieceId ?? null,
        note: context.note,
        context: tx.json({ date: context.date, weather: context.weather, pieces: context.pieces, for: context.kind ?? 'week' }),
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
    const existing = await matchingLooks(tx)
    for (const [position, look] of draft.looks.entries()) await offerLook(tx, set.id, position, look, existing)
    return set.id
  })
}

type NewLook = Omit<LookDraft, 'better_with'> & { better_with?: LookDraft['better_with'] }

/** What makes two looks the same outfit: the same pieces, and gym or not. */
export function lookKey(look: { occasion: string; piece_ids: number[] }): string {
  return `${look.occasion === 'gym' ? 'gym' : 'everyday'}:${signature(look.piece_ids)}`
}

/**
 * Every look a new one may turn out to be, by lookKey: saved ones, and ones
 * offered before (in a set of looks, or on a day) that he has not dismissed
 * and that no remake replaced.
 * Where more than one has the same pieces, the one he saved wins, then one
 * with a picture already drawn, then the newest. A dismissed look is never
 * reused; tidyLooks and tidyDay keep the recent ones out, and an older one
 * comes back as a new look.
 */
export async function matchingLooks(sql: Sql | postgres.TransactionSql): Promise<Map<string, number>> {
  const looks = await sql<{ id: number; occasion: string; piece_ids: number[] }[]>`
    select l.id::int as id, l.occasion, array(select lp.piece_id::int from look_pieces lp where lp.look_id = l.id) as piece_ids
    from looks l
    where l.status in ('new', 'saved')
    order by l.status = 'saved' desc,
             exists (select 1 from look_images i where i.look_id = l.id and i.status = 'ready') desc,
             l.created_at desc, l.id desc
  `
  const byKey = new Map<string, number>()
  for (const look of looks) {
    const key = lookKey(look)
    if (!byKey.has(key)) byKey.set(key, look.id)
  }
  return byKey
}

/**
 * One look of a set, at its place: the look already made with the same
 * pieces (matchingLooks), so it keeps its pictures and what he did with it,
 * else a new one. Returns the look's id.
 */
export async function offerLook(
  tx: Sql | postgres.TransactionSql,
  setId: number,
  position: number,
  look: NewLook,
  existing: Map<string, number>,
): Promise<number> {
  const lookId = existing.get(lookKey(look)) ?? (await insertLook(tx, setId, position, look))
  existing.set(lookKey(look), lookId)
  await tx`insert into look_set_looks ${tx({ set_id: setId, position, look_id: lookId })}`
  return lookId
}

/** A new look and its pieces, in order. Returns the look's id. */
export async function insertLook(tx: Sql | postgres.TransactionSql, setId: number, position: number, look: NewLook): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    insert into looks ${tx({
      set_id: setId,
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
  if (!row) throw new Error('look insert returned nothing')
  await tx`
    insert into look_pieces ${tx(look.piece_ids.map((piece_id, index) => ({ look_id: row.id, piece_id, position: index })))}
  `
  return row.id
}

export type Look = {
  id: number
  set_id: number
  title: string
  occasion: Occasion
  weather: string
  why: string
  styling: string | null
  /** The wanted slot that would lift it, with its colours' names from the guide. */
  better: { slot_id: number; name: string; colours: string[]; colour_names: (string | null)[]; why: string | null } | null
  /** Replaced: remade (look-remake.ts), kept for the days he wore it. */
  status: 'new' | 'saved' | 'dismissed' | 'replaced'
  piece_count: number
  pieces: Piece[]
  /** Days he wore it, newest first, as YYYY-MM-DD in New Zealand. */
  worn: string[]
  /** How often it was offered: each set it was in, each day on Today (look_offers, migration 0022). */
  offered: number
  /** Of those, the days it was one of the day's options or the gym fit. */
  on_today: number
  /** The latest try-on of the whole look, if he asked for one. */
  on_me: OnMe | null
  /** The pieces he marked, while a remake of it is being made. */
  remaking: { swap: number[]; remove: number[] } | null
}

export type LookSet = {
  id: number
  note: string | null
  kind: LookKind
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

type LookRow = Omit<Look, 'pieces' | 'better' | 'on_me'> & {
  piece_ids: number[]
  better_slot_id: number | null
  better_name: string | null
  better_colours: string[] | null
  better_why: string | null
}

/** Looks with their pieces, the slot that would lift them, the days worn and the latest try-on. */
async function selectLooks(sql: Sql, where: postgres.Fragment, order: postgres.Fragment): Promise<Look[]> {
  const rows = await sql<LookRow[]>`
    select l.id::int as id, l.set_id::int as set_id, l.title, l.occasion, l.weather, l.why, l.styling, l.status, l.piece_count,
           l.better_slot_id::int as better_slot_id, s.name as better_name, s.colours as better_colours, l.better_why,
           array(select lp.piece_id::int from look_pieces lp where lp.look_id = l.id order by lp.position) as piece_ids,
           array(select to_char(w.worn_on, 'YYYY-MM-DD') from look_wears w where w.look_id = l.id order by w.worn_on desc) as worn,
           (select count(*)::int from look_offers o where o.look_id = l.id) as offered,
           (select count(o.for_date)::int from look_offers o where o.look_id = l.id) as on_today,
           (select json_build_object('swap', r.swap, 'remove', r.remove) from look_remakes r
            where r.look_id = l.id and r.status = 'making' and r.started_at > now() - interval '5 minutes'
            limit 1) as remaking
    from looks l
    left join blueprint_slots s on s.id = l.better_slot_id and s.status in ('wanted', 'candidate')
    where ${where}
    order by ${order}
  `
  const [pieceList, onMe, guide] = await Promise.all([listPieces(sql), latestLookTryOns(rows.map((row) => row.id), sql), getGuide()])
  const pieces = new Map(pieceList.map((piece) => [piece.id, piece]))
  return rows.map((row) => ({
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
        ? {
            slot_id: row.better_slot_id,
            name: row.better_name,
            colours: row.better_colours ?? [],
            colour_names: (row.better_colours ?? []).map((hex) => colourNameFor(guide, hex)),
            why: row.better_why,
          }
        : null,
    pieces: row.piece_ids.flatMap((id) => (pieces.has(id) ? [pieces.get(id)!] : [])),
    worn: row.worn,
    offered: row.offered,
    on_today: row.on_today,
    on_me: onMe.get(row.id) ?? null,
    remaking: row.remaking,
  }))
}

/** Some looks by id, in the order asked for. */
export async function getLooks(ids: number[], sql: Sql = db()): Promise<Look[]> {
  if (ids.length === 0) return []
  const looks = await selectLooks(sql, sql`l.id in ${sql(ids)}`, sql`l.id`)
  const byId = new Map(looks.map((look) => [look.id, look]))
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}

/**
 * The newest set's looks he has not dismissed (one an earlier set or day
 * made, when it offered that again), and the looks he saved from earlier
 * sets. The outfit of the day's sets are not sets he made here, so
 * the newest is the newest he made; a day's look he saved or wore is with
 * the saved.
 */
export async function readLooks(sql: Sql = db()): Promise<LooksPage> {
  const [latest] = await sql<LookSet[]>`
    select id::int as id, note, coalesce(context ->> 'for', 'week') as kind, usd::float as usd, proposed,
           coalesce((context ->> 'pieces')::int, 0) as pieces, created_at
    from look_sets where kind = 'set' order by created_at desc, id desc limit 1
  `
  const [total] = await sql<{ sets: number; usd: number }[]>`
    select count(*)::int as sets, coalesce(sum(usd), 0)::float as usd from look_sets where kind = 'set'
  `
  const offered = latest
    ? await sql<{ look_id: number; position: number }[]>`
        select look_id::int as look_id, position from look_set_looks where set_id = ${latest.id}
      `
    : []
  const place = new Map(offered.map((row) => [row.look_id, row.position]))
  const looks = await selectLooks(
    sql,
    sql`l.status = 'saved' or (l.status = 'new' and l.id in ${sql(offered.length > 0 ? [...place.keys()] : [0])})`,
    sql`l.acted_at desc nulls last, l.id`,
  )
  // A look saved from the newest set stays where it is, so a tap never moves the card under his finger.
  const inLatest = (look: Look) => place.has(look.id)
  return {
    saved: looks.filter((look) => !inLatest(look)).sort((a, b) => (b.worn[0] ?? '').localeCompare(a.worn[0] ?? '')),
    latest: latest ?? null,
    fresh: looks.filter(inLatest).sort((a, b) => place.get(a.id)! - place.get(b.id)!),
    total: total ?? { sets: 0, usd: 0 },
  }
}

export type PieceLooks = {
  /** The newest set made around the piece, if any. */
  latest: LookSet | null
  /** Its looks he has not dismissed, in the order they were made. */
  looks: Look[]
}

/**
 * The newest looks made around one piece, less what he dismissed and what a
 * remake replaced (the remake is in its place). One saved stays, marked saved.
 */
export async function readPieceLooks(pieceId: number, sql: Sql = db()): Promise<PieceLooks> {
  const [latest] = await sql<LookSet[]>`
    select id::int as id, note, coalesce(context ->> 'for', 'week') as kind, usd::float as usd, proposed,
           coalesce((context ->> 'pieces')::int, 0) as pieces, created_at
    from look_sets where kind = 'piece' and piece_id = ${pieceId} order by created_at desc, id desc limit 1
  `
  if (!latest) return { latest: null, looks: [] }
  const offered = await sql<{ look_id: number; position: number }[]>`
    select look_id::int as look_id, position from look_set_looks where set_id = ${latest.id}
  `
  if (offered.length === 0) return { latest, looks: [] }
  const place = new Map(offered.map((row) => [row.look_id, row.position]))
  const looks = await selectLooks(sql, sql`l.id in ${sql([...place.keys()])} and l.status in ('new', 'saved')`, sql`l.id`)
  return { latest, looks: looks.sort((a, b) => place.get(a.id)! - place.get(b.id)!) }
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
