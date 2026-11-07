import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { MODELS, callUsd } from './claude.ts'
import { db, type Sql } from './db.ts'
import {
  dressable,
  getLooks,
  GYM_FIT_RULES,
  gymForPrompt,
  gymReadiness,
  LookDraftSchema,
  matchingLooks,
  offerLook,
  pieceForPrompt,
  readHistory,
  readiness,
  tidyLooks,
  wellingtonToday,
  type History,
  type Look,
  type LookDismissReason,
} from './looks.ts'
import { ensureLookImage, latestLookImages, type LookImage } from './look-image.ts'
import { listPieces, type Piece } from './pieces.ts'
import { getProfile, type Profile } from './profile.ts'
import { weekdayOf } from './profile-values.ts'
import { GenerationError, generate, type GenerationMeta } from './structured.ts'
import { getGuide, profileBrief, type Guide } from './style-guide.ts'
import { limitForPrompt, withinWarmth, WARMTH_RULES, warmthLimit, type WarmthLimit } from './warmth.ts'
import { dressDate, fetchForecast, forecastLine, nzDate, nzSeason, weekday, type Forecast } from './weather.ts'

/*
 * The outfit of the day (migration 0011). Opus dresses him for one day from
 * the pieces he owns: that day's Wellington forecast for the hours he is out,
 * the season, the day of the week against his week, and what he said is on.
 * Three options, best first; Today shows one and "Another" turns to the next.
 *
 * Each option is a look, so Save and "Wore it today" are the looks' own and
 * the next set of looks learns from them. When an option is piece for piece a
 * look already made (saved, or offered before on another day or in a set of
 * looks, and not dismissed), it is that look, not a copy, so it keeps its
 * picture and nothing is drawn again. The option on show gets a picture, a
 * flat lay of the outfit drawn by OpenAI (look-image.ts), made after the
 * outfit and kept with the look. Made the first time Today is
 * opened for a day (after six in the evening, for tomorrow), in the
 * background; the card refreshes until it is there.
 *
 * Every option is held to the day's warmth limit (warmth.ts), read from the
 * forecast: left to itself Opus dressed him in three layers and wool on a
 * warm day.
 *
 * On a day he trains (a gym day on his week, or a note that says so) the same
 * call adds a gym fit from his gym kit (migration 0014): one look of the gym
 * occasion, shown under the day's outfit. It gets no picture without a tap.
 */

export const DAY_OPTIONS = 3

/** A making row older than this died with its process; the next start closes it. */
const STALE_MINUTES = 5

/** How far back an outfit he wore is not offered again. */
const NOT_AGAIN_DAYS = 6

// ---------------------------------------------------------------------------
// Claude's output format
// ---------------------------------------------------------------------------

export const DayOptionSchema = LookDraftSchema.omit({ better_with: true }).extend({
  today: z
    .string()
    .describe(
      'One sentence for this day only, tying the outfit to the forecast and what is on: "Showers from 3pm and a 40 km/h southerly: the shell over the knit, and the leather boots rather than the suede."',
    ),
})

export const DaySchema = z.object({
  options: z.array(DayOptionSchema).describe(`${DAY_OPTIONS} outfits for the day, best first, each a different outfit.`),
  gym: DayOptionSchema.nullable().describe('On a day he trains, one gym fit from his gym kit, occasion gym; otherwise null.'),
})

export type DayOption = z.infer<typeof DayOptionSchema>

export const DAY_SYSTEM_PROMPT = `You are an experienced menswear stylist dressing one client for one day from clothes he already owns. You have his confirmed profile (colouring, proportions, sizes, his week), the style guide written for him, the list of his pieces, the looks he saved and dismissed, what he wore this past week, the day and its forecast. A private app shows him the first option on its Today page each morning (or the evening before), with the others a tap away.

Give ${DAY_OPTIONS} options for the day, best first. Each is one complete outfit: at least one top, exactly one pair of trousers, jeans or shorts, exactly one pair of shoes, and an outer layer when the day asks for it. Accessories only when they add something, and then in his metal. Use only the pieces on the list, by id, each at most once in an outfit; never invent a garment. The options must differ: no two share more than two pieces.

Dress him for the forecast, not the month or the season. You are given the hours he is likely out, 7am to 10pm, with temperature, feels-like temperature, rain chance and wind, and the day's warmth_limit, which every option must keep to: no more layers than most_layers, no more warm pieces than most_warm_pieces, none of garments_ruled_out; null means no limit. An option over it is thrown away. ${WARMTH_RULES} Wind matters for what a garment does in it: it cuts through an open knit and lifts an unbuttoned layer. Dress for the warm middle of the day, not its coolest hour: when the morning or evening is cooler, the answer is one light layer he can take off and carry, never a warmer outfit. Warm days want light cloth, cotton and linen, a tee or a short-sleeved shirt; wool and knits are for cool days. Rain likely while he is out calls for an outer layer that sheds water, if he owns one and the limit has room, and shoes that cope (no suede). A UV index of 6 or more is strong in New Zealand: sunglasses or a cap if he has them. When no forecast could be read you are given the month's usual weather instead, and the limit is read from its usual high; dress for an ordinary day of it.

The season sets the mood within his palette, never the warmth: the lighter and brighter of his colours in spring and summer, the deeper ones in autumn and winter. Never step outside his palette to follow a season.

Work out the day from the weekday and his week: an office day, a weekend, or a day with an evening out. Where his week is empty, weekdays are office days. Office means smart casual unless his profile says otherwise. If he said what is on, that decides; dress for the most demanding part of the day and say how to adjust for the rest.

${GYM_FIT_RULES} The day's options are everyday outfits, never gym fits. When he trains this day (trains_today, or his note says he is training) and his gym kit is ready (gym.kit_ready), also give gym: one gym fit for this day's weather on the walk there, within the same warmth_limit, a layer when it is cold or wet; its today line says what about the day it answers. Otherwise gym is null. A gym fit may repeat one he wore this week or saved; kit is small.

He may re-wear a look he saved, piece for piece, when it suits the day; it is often the best option. Never offer an outfit he wore in the past week, piece for piece, nor one he dismissed, and learn from the reasons he gave. Prefer pieces he has worn less lately.

For each option: today is one sentence on why it suits this day, naming the weather or the plan it answers; why is two sentences that hold on any day, the colour story in his palette and then the proportion or fit move from his guide; weather is the kind of day it is dressed for in a few words; styling is one short instruction for wearing it, or null.

Write to him in the second person, plainly, without praise or sales talk. Plain hyphens only.`

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export type Worn = { date: string; title: string; piece_ids: number[] }

export type DayInput = {
  profile: Profile
  guide: Guide
  pieces: Piece[]
  history: History
  /** Looks he wore in the past week, newest first. */
  wornThisWeek: Worn[]
  /** The day it dresses him for, YYYY-MM-DD in New Zealand. */
  date: string
  forecast: Forecast | null
  note: string | null
  now?: Date
}

/** The forecast for the prompt: the summary line, the day's figures and the hours. */
function forecastForPrompt(forecast: Forecast) {
  return {
    in_short: forecastLine(forecast),
    temperature_c: { low: forecast.low, high: forecast.high, feels_like_low: forecast.feels_low, feels_like_high: forecast.feels_high },
    rain: { highest_chance_pct: forecast.rain_chance, total_mm: forecast.rain_mm },
    wind: { strongest_kmh: forecast.wind_kmh, gusts_kmh: forecast.gust_kmh, from: forecast.wind_from },
    sky: forecast.sky,
    uv_index: forecast.uv,
    hours: forecast.hours,
  }
}

/**
 * The day's warmth limit: from the warmest the forecast feels, else from the
 * month's usual high when no forecast could be read.
 */
export function dayLimit(input: Pick<DayInput, 'forecast' | 'date'>): WarmthLimit {
  return warmthLimit(input.forecast?.feels_high ?? usualFor(input.date).high)
}

function usualFor(date: string) {
  return wellingtonToday(new Date(`${date}T12:00:00+12:00`))
}

/** Whether his week says he trains on this day. */
export function trainsOn(profile: Pick<Profile, 'life'>, date: string): boolean {
  return profile.life.gym_days?.includes(weekdayOf(date)) ?? false
}

export function buildDayMessages(input: DayInput): Anthropic.Beta.BetaMessageParam[] {
  const now = input.now ?? new Date()
  const body = {
    day: {
      date: input.date,
      weekday: weekday(input.date),
      trains_today: trainsOn(input.profile, input.date),
      dressing_for: input.date === nzDate(now) ? 'today' : 'tomorrow, laid out the evening before',
      season_in_new_zealand: nzSeason(input.date),
    },
    ...(input.forecast
      ? { forecast_wellington: forecastForPrompt(input.forecast) }
      : { usual_weather: `${usualFor(input.date).weather} (no forecast could be read)` }),
    warmth_limit: input.forecast
      ? limitForPrompt(dayLimit(input))
      : limitForPrompt(dayLimit(input), `the month's usual high, ${usualFor(input.date).high}°`),
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
    looks_he_saved: input.history.saved,
    looks_he_dismissed: input.history.dismissed,
    worn_this_week: input.wornThisWeek,
  }
  const ask = input.note
    ? `He says this is on: "${input.note}". Dress him for the day with that in mind: ${DAY_OPTIONS} options, best first.`
    : `Dress him for the day: ${DAY_OPTIONS} options, best first.`
  return [{ role: 'user', content: `${JSON.stringify(body, null, 2)}\n\n${ask}` }]
}

export type DayDraft = { options: DayOption[]; gym: DayOption | null; proposed: number; meta: GenerationMeta; usd: number }

export async function draftDay(input: DayInput): Promise<DayDraft> {
  const { data, meta } = await generate({
    schema: DaySchema,
    system: DAY_SYSTEM_PROMPT,
    messages: buildDayMessages(input),
    maxTokens: 16000,
    what: 'outfit of the day',
    model: MODELS.day,
  })
  const usd = callUsd(MODELS.day, { input_tokens: meta.input_tokens, output_tokens: meta.output_tokens })
  const limit = dayLimit(input)
  const gym = gymReadiness(input.pieces).ready && data.gym ? tidyGym(data.gym, input.pieces, input.history, limit) : null
  return {
    options: tidyDay(data.options, input.pieces, input.history, input.wornThisWeek, limit),
    gym,
    proposed: data.options.length,
    meta,
    usd,
  }
}

type Tidyable = Pick<Piece, 'id' | 'name' | 'garment_type' | 'fabric' | 'warmth' | 'set_aside_at' | 'worn_for'>

/** The options whose pieces sit within the day's warmth limit. */
function warmEnough<T extends Pick<DayOption, 'piece_ids'>>(options: T[], pieces: Tidyable[], limit: WarmthLimit | null): T[] {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  return options.filter((option) => withinWarmth(option.piece_ids.map((id) => byId.get(id)!), limit))
}

/**
 * Holds the options to what a look must be (tidyLooks), with the day's own
 * rules on what has gone before: a look he saved may come back, one he
 * dismissed or wore this past week may not. A gym fit is not one of the
 * day's options, and none may be warmer than the day's limit. At most
 * DAY_OPTIONS are kept.
 */
export function tidyDay(
  options: DayOption[],
  pieces: Tidyable[],
  history: Pick<History, 'dismissed'>,
  wornThisWeek: Pick<Worn, 'piece_ids'>[],
  limit: WarmthLimit | null = null,
): DayOption[] {
  const notAgain = [
    ...history.dismissed,
    ...wornThisWeek.map((look) => ({ title: '', piece_ids: look.piece_ids, reason: 'not_me' as LookDismissReason })),
  ]
  const whole = tidyLooks(
    options.filter((option) => option.occasion !== 'gym').map((option) => ({ ...option, title: option.title.trim(), better_with: null })),
    pieces,
    [],
    { saved: [], dismissed: notAgain },
  )
  return warmEnough(whole, pieces, limit).slice(0, DAY_OPTIONS)
}

/**
 * The day's gym fit held to what a gym fit must be, and to the day's warmth
 * limit. Kit is small, so one he wore this week or saved may come back; one
 * he dismissed may not.
 */
export function tidyGym(
  gym: DayOption,
  pieces: Tidyable[],
  history: Pick<History, 'dismissed'>,
  limit: WarmthLimit | null = null,
): DayOption | null {
  const whole = tidyLooks(
    [{ ...gym, occasion: 'gym' as const, title: gym.title.trim(), better_with: null }],
    pieces,
    [],
    { saved: [], dismissed: history.dismissed },
  )
  const [kept] = warmEnough(whole, pieces, limit)
  return kept ?? null
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Looks he wore in the past week, newest first, so the day does not repeat one. */
export async function wornThisWeek(sql: Sql = db()): Promise<Worn[]> {
  return sql<Worn[]>`
    select to_char(w.worn_on, 'YYYY-MM-DD') as date, l.title,
           array(select lp.piece_id::int from look_pieces lp where lp.look_id = l.id order by lp.position) as piece_ids
    from look_wears w join looks l on l.id = w.look_id
    where w.worn_on > (now() at time zone 'Pacific/Auckland')::date - ${NOT_AGAIN_DAYS + 1}::int
    order by w.worn_on desc
  `
}

export type DayStarted = { ok: true; id: number } | { ok: false; message: string }

async function sweepStale(sql: Sql): Promise<void> {
  await sql`
    update day_outfits set status = 'failed', finished_at = now(), error = 'It stopped part way. Try again.'
    where status = 'making' and started_at < now() - make_interval(mins => ${STALE_MINUTES})
  `
}

/**
 * Records a day in the making, with its forecast, or says why it cannot be
 * made. The outfit itself is made by runDay, after the response. Without
 * `again`, a day that already has an outfit (or one in the making) is left
 * as it is, so a second tab or a refresh never pays twice.
 */
export async function startDay(
  options: { note?: string | null; again?: boolean; now?: Date } = {},
  sql: Sql = db(),
): Promise<DayStarted> {
  const date = dressDate(options.now)
  const [guide, pieces] = await Promise.all([getGuide(), listPieces(sql)])
  if (!guide) return { ok: false, message: 'Draft your style guide first. The outfit is put together against it.' }
  const ready = readiness(pieces)
  if (!ready.ready) return { ok: false, message: `Add ${ready.missing.join(', ')} first.` }

  await sweepStale(sql)
  if (!options.again) {
    const [existing] = await sql<{ id: number }[]>`
      select id::int as id from day_outfits
      where for_date = ${date} and status in ('making', 'ready')
      order by started_at desc limit 1
    `
    if (existing) return { ok: true, id: existing.id }
  }

  const forecast = await fetchForecast(date)
  const note = options.note?.trim().replace(/\s+/g, ' ').slice(0, 200) || null
  try {
    const [row] = await sql<{ id: number }[]>`
      insert into day_outfits (for_date, note, forecast)
      values (${date}, ${note}, ${forecast ? sql.json(forecast) : null})
      returning id::int as id
    `
    return { ok: true, id: row!.id }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, message: 'An outfit is already being put together. It will be here in a moment.' }
    }
    throw error
  }
}

export type DayDeps = {
  draft: (input: DayInput) => Promise<DayDraft>
  /** Draws the picture of the option on show; the tests pass one that does not call OpenAI. */
  draw: (lookId: number, sql: Sql) => Promise<void>
}

/**
 * Makes the day's outfit, then the picture of its first option. The outfit
 * is shown as soon as it is in; the picture follows. Never throws: a failure
 * is recorded on the row, in words for him.
 */
export async function runDay(id: number, sql: Sql = db(), deps: Partial<DayDeps> = {}): Promise<void> {
  const { draft = draftDay, draw = ensureLookImage } = deps
  const started = Date.now()
  try {
    const [day] = await sql<{ for_date: string; note: string | null; forecast: Forecast | null }[]>`
      select to_char(for_date, 'YYYY-MM-DD') as for_date, note, forecast from day_outfits where id = ${id} and status = 'making'
    `
    if (!day) return
    const [profile, guide, pieces, history, worn] = await Promise.all([
      getProfile(),
      getGuide(),
      listPieces(sql),
      readHistory(sql),
      wornThisWeek(sql),
    ])
    if (!guide) throw new GenerationError('Draft your style guide first.')
    const made = await draft({
      profile,
      guide,
      pieces,
      history,
      wornThisWeek: worn,
      date: day.for_date,
      forecast: day.forecast,
      note: day.note,
    })
    if (made.options.length === 0) {
      console.warn(JSON.stringify({ event: 'day.none_kept', id, proposed: made.proposed, usd: made.usd }))
      throw new GenerationError('None of the outfits Claude put together held up. Try again.')
    }
    const first = await saveDay(id, made, pieces.filter((piece) => !piece.set_aside_at).length, sql)
    console.info(
      JSON.stringify({
        event: 'day.ready',
        id,
        options: made.options.length,
        gym: made.gym !== null,
        proposed: made.proposed,
        usd: made.usd,
        ms: Date.now() - started,
      }),
    )
    await draw(first, sql)
  } catch (error) {
    const message = error instanceof GenerationError ? error.message : 'Something went wrong putting it together. Try again.'
    console.warn(JSON.stringify({ event: 'day.failed', id, message: (error as Error).message, cause: (error as Error).cause ?? null }))
    await sql`
      update day_outfits set status = 'failed', error = ${message}, finished_at = now() where id = ${id} and status = 'making'
    `
  }
}

/**
 * The call as a set of the day's kind, then each option and the gym fit: the
 * look it matches piece for piece (matchingLooks), else a new look. The day
 * is ready once all of it is in. Returns the first option's look, the one on
 * show.
 */
export async function saveDay(id: number, draft: DayDraft, pieces: number, sql: Sql = db()): Promise<number> {
  return sql.begin(async (tx) => {
    const [day] = await tx<{ for_date: string; forecast: Forecast | null }[]>`
      select to_char(for_date, 'YYYY-MM-DD') as for_date, forecast from day_outfits where id = ${id} for update
    `
    if (!day) throw new Error(`day ${id} is gone`)
    const [set] = await tx<{ id: number }[]>`
      insert into look_sets ${tx({
        kind: 'day',
        note: null,
        context: tx.json({ date: day.for_date, weather: day.forecast ? forecastLine(day.forecast) : null, pieces }),
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
    const lookIds: number[] = []
    for (const [position, option] of draft.options.entries()) {
      const lookId = await offerLook(tx, set.id, position, option, existing)
      await tx`insert into day_outfit_options ${tx({ day_id: id, position, look_id: lookId, today: option.today })}`
      lookIds.push(lookId)
    }
    const gymId = draft.gym ? await offerLook(tx, set.id, draft.options.length, draft.gym, existing) : null
    await tx`
      update day_outfits
      set status = 'ready', set_id = ${set.id}, shown = 0, gym_look_id = ${gymId}, gym_today = ${draft.gym?.today ?? null},
          finished_at = now()
      where id = ${id}
    `
    return lookIds[0]!
  })
}

export type DayOutfit = {
  id: number
  for_date: string
  status: 'making' | 'ready' | 'failed'
  note: string | null
  forecast: Forecast | null
  error: string | null
  shown: number
  usd: number | null
  /** What changing its looks' pieces cost (look-remake.ts), failed tries included. */
  remake_usd: number
  started_at: Date
  options: DayLook[]
  /** On a day he trains, what to wear to the gym. */
  gym: DayLook | null
}

export type DayLook = { look: Look; today: string; image: LookImage | null }

/** The newest outfit for a day, with its options, or null when there is none yet. */
export async function readDay(date: string, sql: Sql = db()): Promise<DayOutfit | null> {
  type Row = Omit<DayOutfit, 'options' | 'gym'> & {
    option_rows: { look_id: number; today: string }[] | null
    gym_look_id: number | null
    gym_today: string | null
  }
  const [row] = await sql<Row[]>`
    select d.id::int as id, to_char(d.for_date, 'YYYY-MM-DD') as for_date, d.status, d.note, d.forecast, d.error, d.shown,
           s.usd::float as usd, d.started_at, d.gym_look_id::int as gym_look_id, d.gym_today,
           (select coalesce(sum(r.usd), 0)::float from look_remakes r where r.day_id = d.id) as remake_usd,
           (select json_agg(json_build_object('look_id', o.look_id::int, 'today', o.today) order by o.position)
            from day_outfit_options o where o.day_id = d.id) as option_rows
    from day_outfits d left join look_sets s on s.id = d.set_id
    where d.for_date = ${date}
    order by d.started_at desc, d.id desc
    limit 1
  `
  if (!row) return null
  const { option_rows, gym_look_id, gym_today, ...day } = row
  const rows = [...(option_rows ?? []), ...(gym_look_id && gym_today ? [{ look_id: gym_look_id, today: gym_today }] : [])]
  const lookIds = rows.map((option) => option.look_id)
  const [looks, images] = await Promise.all([getLooks(lookIds, sql), latestLookImages(lookIds, sql)])
  const byId = new Map(looks.map((look) => [look.id, look]))
  const dayLook = (option: { look_id: number; today: string }): DayLook[] =>
    byId.has(option.look_id) ? [{ look: byId.get(option.look_id)!, today: option.today, image: images.get(option.look_id) ?? null }] : []
  const options = (option_rows ?? []).flatMap(dayLook)
  const [gym = null] = gym_look_id && gym_today ? dayLook({ look_id: gym_look_id, today: gym_today }) : []
  return { ...day, shown: options.length > 0 ? day.shown % options.length : 0, options, gym }
}

/** Turns the day to its next option, round to the first after the last. Returns the look now on show. */
export async function showNext(id: number, sql: Sql = db()): Promise<number | null> {
  const [row] = await sql<{ look_id: number }[]>`
    with turned as (
      update day_outfits d set shown = (d.shown + 1) % greatest(1, (select count(*) from day_outfit_options o where o.day_id = d.id))
      where d.id = ${id} and d.status = 'ready'
      returning d.id, d.shown
    )
    select o.look_id::int as look_id from turned t join day_outfit_options o on o.day_id = t.id and o.position = t.shown
  `
  return row?.look_id ?? null
}

/** Turns the day to the option at `index` (round, so 3 of 3 is the first). Returns the look now on show. */
export async function showOption(id: number, index: number, sql: Sql = db()): Promise<number | null> {
  const [row] = await sql<{ look_id: number }[]>`
    with turned as (
      update day_outfits d set shown = ${index} % greatest(1, (select count(*) from day_outfit_options o where o.day_id = d.id))
      where d.id = ${id} and d.status = 'ready'
      returning d.id, d.shown
    )
    select o.look_id::int as look_id from turned t join day_outfit_options o on o.day_id = t.id and o.position = t.shown
  `
  return row?.look_id ?? null
}
