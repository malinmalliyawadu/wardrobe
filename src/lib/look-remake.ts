import type Anthropic from '@anthropic-ai/sdk'
import type { TransactionSql } from 'postgres'
import { z } from 'zod'

import { MODELS, callUsd } from './claude.ts'
import { db, type Sql } from './db.ts'
import { REMAKE_NOTE_MAX, wholeWithout } from './look-rules.ts'
import {
  dressable,
  getLooks,
  GYM_FIT_RULES,
  insertLook,
  LookDraftSchema,
  lookKey,
  matchingLooks,
  pieceForPrompt,
  readHistory,
  tidyLooks,
  wellingtonToday,
  type History,
  type Look,
} from './looks.ts'
import { listPieces, type Piece } from './pieces.ts'
import { getProfile, type Profile } from './profile.ts'
import { GenerationError, generate, type GenerationMeta } from './structured.ts'
import { getGuide, profileBrief, type Guide } from './style-guide.ts'
import { forEveryday, forGym } from './wardrobe-values.ts'
import { dayLimit } from './day-outfit.ts'
import { limitForPrompt, WARMTH_RULES } from './warmth.ts'
import { dressDate, forecastLine, nzSeason, weekday, type Forecast } from './weather.ts'

/*
 * Remaking a look (migration 0015). On a look Claude put together he marks
 * pieces to swap for another of his and pieces to remove; Opus remakes the
 * look around the pieces he kept and writes its words again. Code holds the
 * answer to what he asked (every kept piece in, every marked piece out, at
 * most one new piece for each swapped one) and to what a look must be
 * (tidyLooks), or the remake fails in words and the look stays as it was.
 *
 * The remake is a new look in the old one's place (the same set and
 * position, saved if the old one was, and in every current day's outfit that
 * showed it); the old one is kept as replaced, with the days he wore it. A
 * look worn today hands that day to its remake: he is wearing the new one.
 */

/** A making row older than this died with its process; the next start closes it. */
const STALE_MINUTES = 5

// ---------------------------------------------------------------------------
// Claude's output format
// ---------------------------------------------------------------------------

export const RemakeSchema = LookDraftSchema.pick({ title: true, weather: true, piece_ids: true, why: true, styling: true }).extend({
  today: z
    .string()
    .nullable()
    .describe('When a day is given, one sentence for that day tying the outfit to its forecast and what is on. Otherwise null.'),
})

export type RemakeDraft = z.infer<typeof RemakeSchema>

export const REMAKE_SYSTEM_PROMPT = `You are an experienced menswear stylist. You put together a look for one client from clothes he already owns, and he has marked some of its pieces to change. You have the look, each of its pieces marked keep, swap or remove, the rest of his pieces you may choose from, his confirmed profile and the style guide written for him.

A piece marked swap comes out, and one other piece from pieces_to_choose_from goes in its place: the one that does its job in this look best for him. It may be a different garment (sneakers for boots, an overshirt for a knit) as long as the look stays one whole outfit. He swapped it for a reason, so choose something that changes what it did (its colour, weight or formality) rather than its near twin, unless his note says otherwise. A piece marked remove comes out with nothing in its place. Every piece marked keep stays. Add nothing else.

The remade look is still one complete outfit: at least one top, exactly one pair of trousers, jeans or shorts, exactly one pair of shoes, each piece once. Use only ids from the look and from pieces_to_choose_from. ${GYM_FIT_RULES} Dress it for the same occasion and the same day as before. When a day is given, what you bring in keeps the look within its warmth_limit where the kept pieces allow: no more layers than most_layers, no more warm pieces than most_warm_pieces, none of garments_ruled_out; null means no limit. ${WARMTH_RULES} When he wrote a note, it decides between the candidates.

Then write the look's words again for what it is now, as if it had always been this look: never mention what came out or why. title: two to five words, plain, a new one when the change shows in it. weather: the kind of day it is dressed for, in a few words. why: exactly two short sentences to him, the colour story in his palette and then the one proportion or fit move from his guide that the look uses; describe only what the pieces' words say, never a detail they do not. styling: one short instruction for wearing it, or null. today: when a day is given, one sentence for that day naming the weather or the plan it answers; otherwise null. piece_ids: the outermost layer first, down to the shoes, then any accessories.

Respect his no-gos absolutely. Write to him in the second person, plainly, without praise or sales talk. Plain hyphens only.`

// ---------------------------------------------------------------------------
// What he asked for
// ---------------------------------------------------------------------------

export type RemakeAsk = { look_id: number; swap: number[]; remove: number[]; note: string | null }

export const RemakeAskSchema = z.object({
  look_id: z.number().int().positive(),
  swap: z.array(z.number().int().positive()).max(8),
  remove: z.array(z.number().int().positive()).max(8),
  note: z
    .string()
    .nullable()
    .transform((note) => note?.trim().replace(/\s+/g, ' ').slice(0, REMAKE_NOTE_MAX) || null),
})

/**
 * Why this ask cannot be remade, in words for him, or null when it can: the
 * look must be his to change and whole, at least one of its pieces marked,
 * every piece he keeps still in his wardrobe, and what is left once the
 * removed pieces are out still an outfit.
 */
export function remakeProblem(
  look: Pick<Look, 'status' | 'piece_count'> & { pieces: Pick<Piece, 'id' | 'name' | 'garment_type' | 'set_aside_at'>[] },
  ask: Pick<RemakeAsk, 'swap' | 'remove'>,
): string | null {
  if (look.status !== 'new' && look.status !== 'saved') return 'This look has gone.'
  if (look.pieces.length < look.piece_count) return 'A piece of this look is no longer in your wardrobe.'
  const ids = new Set(look.pieces.map((piece) => piece.id))
  const swap = new Set(ask.swap)
  const remove = new Set(ask.remove)
  if (swap.size + remove.size === 0) return 'Mark a piece to swap or remove first.'
  if ([...swap, ...remove].some((id) => !ids.has(id)) || [...swap].some((id) => remove.has(id))) {
    return 'The look changed. Reload and try again.'
  }
  const aside = look.pieces.find((piece) => piece.set_aside_at && !swap.has(piece.id) && !remove.has(piece.id))
  if (aside) return `${aside.name} is set aside. Swap or remove it too.`
  if (!wholeWithout(look.pieces, remove)) return 'Without those it is not a whole outfit. Swap one instead of removing it.'
  return null
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** The day the look is dressed for, when it is an option or the gym fit of a current day's outfit. */
export type RemakeDay = { id: number; date: string; forecast: Forecast | null; note: string | null; today: string }

export type RemakeInput = {
  profile: Profile
  guide: Guide
  pieces: Piece[]
  history: History
  look: Look
  ask: RemakeAsk
  day: RemakeDay | null
}

export function buildRemakeMessages(input: RemakeInput): Anthropic.Beta.BetaMessageParam[] {
  const { look, ask, day } = input
  const swap = new Set(ask.swap)
  const remove = new Set(ask.remove)
  const inLook = new Set(look.pieces.map((piece) => piece.id))
  const wornFor = look.occasion === 'gym' ? forGym : forEveryday
  const body = {
    look: {
      title: look.title,
      occasion: look.occasion,
      weather: look.weather,
      why: look.why,
      styling: look.styling,
      ...(day ? { today: day.today } : {}),
      pieces: look.pieces.map((piece) => ({
        ...pieceForPrompt(piece, input.guide, input.history.worn),
        he_says: swap.has(piece.id) ? 'swap' : remove.has(piece.id) ? 'remove' : 'keep',
      })),
    },
    ...(day
      ? {
          day: {
            date: day.date,
            weekday: weekday(day.date),
            season_in_new_zealand: nzSeason(day.date),
            forecast_wellington: day.forecast ? forecastLine(day.forecast) : null,
            warmth_limit: limitForPrompt(dayLimit(day)),
            what_is_on: day.note,
          },
        }
      : { usual_weather: wellingtonToday().weather }),
    profile: profileBrief(input.profile),
    style_guide: {
      palette: input.guide.palette,
      silhouette: input.guide.silhouette,
      shoes: input.guide.shoes,
      accessories: input.guide.accessories,
      fit_vocabulary: input.guide.fit_vocabulary,
    },
    pieces_to_choose_from: dressable(input.pieces)
      .filter((piece) => !inLook.has(piece.id) && wornFor(piece))
      .map((piece) => pieceForPrompt(piece, input.guide, input.history.worn)),
    looks_he_dismissed: input.history.dismissed,
  }
  const counts = [
    swap.size > 0 ? `${swap.size} ${swap.size === 1 ? 'piece' : 'pieces'} to swap` : null,
    remove.size > 0 ? `${remove.size} to remove` : null,
  ]
    .filter(Boolean)
    .join(', ')
  const said = ask.note ? ` He says: "${ask.note}".` : ''
  return [{ role: 'user', content: `${JSON.stringify(body, null, 2)}\n\nRemake the look: ${counts}.${said}` }]
}

export type RemakeResult = { draft: RemakeDraft; meta: GenerationMeta; usd: number }

export async function draftRemake(input: RemakeInput): Promise<RemakeResult> {
  const { data, meta } = await generate({
    schema: RemakeSchema,
    system: REMAKE_SYSTEM_PROMPT,
    messages: buildRemakeMessages(input),
    maxTokens: 8000,
    what: 'remade look',
    model: MODELS.remake,
  })
  return { draft: data, meta, usd: callUsd(MODELS.remake, { input_tokens: meta.input_tokens, output_tokens: meta.output_tokens }) }
}

/**
 * Holds the remake to what he asked: every piece he kept is in it, none he
 * marked is, and at most one new piece came in for each he swapped (at least
 * one when he swapped any); then to what a look must be (tidyLooks), of the
 * look's own occasion, and not a look he dismissed. Null when it fails.
 */
export function tidyRemake(
  draft: RemakeDraft,
  look: Pick<Look, 'occasion'> & { piece_ids: number[] },
  ask: Pick<RemakeAsk, 'swap' | 'remove'>,
  pieces: Pick<Piece, 'id' | 'garment_type' | 'set_aside_at' | 'worn_for'>[],
  history: Pick<History, 'dismissed'>,
): (RemakeDraft & { occasion: Look['occasion'] }) | null {
  const out = new Set([...ask.swap, ...ask.remove])
  const kept = look.piece_ids.filter((id) => !out.has(id))
  const [tidy] = tidyLooks([{ ...draft, occasion: look.occasion, better_with: null }], pieces, [], { saved: [], dismissed: history.dismissed })
  if (!tidy) return null
  const ids = new Set(tidy.piece_ids)
  const added = tidy.piece_ids.filter((id) => !look.piece_ids.includes(id))
  if (kept.some((id) => !ids.has(id)) || [...out].some((id) => ids.has(id))) return null
  if (added.length > ask.swap.length || (ask.swap.length > 0 && added.length === 0)) return null
  return {
    title: tidy.title,
    occasion: tidy.occasion,
    weather: tidy.weather,
    piece_ids: tidy.piece_ids,
    why: tidy.why,
    styling: tidy.styling,
    today: tidy.today,
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** The newest current day's outfit that shows this look, as an option or its gym fit. */
export async function dayOf(lookId: number, sql: Sql = db()): Promise<RemakeDay | null> {
  const [row] = await sql<RemakeDay[]>`
    select d.id::int as id, to_char(d.for_date, 'YYYY-MM-DD') as date, d.forecast, d.note,
           coalesce(o.today, case when d.gym_look_id = ${lookId} then d.gym_today end) as today
    from day_outfits d
    left join day_outfit_options o on o.day_id = d.id and o.look_id = ${lookId}
    where d.status = 'ready' and d.for_date >= (now() at time zone 'Pacific/Auckland')::date
      and (o.look_id is not null or d.gym_look_id = ${lookId})
    order by d.for_date, d.started_at desc
    limit 1
  `
  return row && row.today ? row : null
}

export type RemakeStarted = { ok: true; id: number } | { ok: false; message: string }

/** Records a remake in the making, or says why it cannot be made. Opus is called by runRemake. */
export async function startRemake(input: RemakeAsk, sql: Sql = db()): Promise<RemakeStarted> {
  const parsed = RemakeAskSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'The look changed. Reload and try again.' }
  const ask = parsed.data
  const [look] = await getLooks([ask.look_id], sql)
  if (!look) return { ok: false, message: 'This look has gone.' }
  const problem = remakeProblem(look, ask)
  if (problem) return { ok: false, message: problem }
  if (!(await getGuide())) return { ok: false, message: 'Draft your style guide first. Looks are put together against it.' }

  await sql`
    update look_remakes set status = 'failed', finished_at = now(), error = 'It stopped part way. Try again.'
    where status = 'making' and started_at < now() - make_interval(mins => ${STALE_MINUTES})
  `
  const day = await dayOf(look.id, sql)
  try {
    const [row] = await sql<{ id: number }[]>`
      insert into look_remakes ${sql({ look_id: look.id, day_id: day?.id ?? null, swap: ask.swap, remove: ask.remove, note: ask.note })}
      returning id::int as id
    `
    return { ok: true, id: row!.id }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, message: 'This look is already being remade.' }
    throw error
  }
}

export type RemakeDone = { ok: true; lookId: number; onShow: boolean } | { ok: false; message: string }

export type RemakeDeps = { draft: (input: RemakeInput) => Promise<RemakeResult> }

/**
 * Makes a recorded remake and puts it in the old look's place. Never throws
 * for what Claude did: a failure is recorded on the row and returned in words
 * for him. `onShow` says the new look is the day's option on show, so the
 * caller draws its picture.
 */
export async function runRemake(id: number, sql: Sql = db(), deps: Partial<RemakeDeps> = {}): Promise<RemakeDone> {
  const { draft = draftRemake } = deps
  const started = Date.now()
  try {
    const [row] = await sql<{ look_id: number; swap: number[]; remove: number[]; note: string | null }[]>`
      select look_id::int as look_id, swap::int[] as swap, remove::int[] as remove, note
      from look_remakes where id = ${id} and status = 'making'
    `
    if (!row) throw new GenerationError('It stopped part way. Try again.')
    const ask: RemakeAsk = { look_id: row.look_id, swap: row.swap, remove: row.remove, note: row.note }
    const [[look], profile, guide, pieces, history, day] = await Promise.all([
      getLooks([row.look_id], sql),
      getProfile(),
      getGuide(),
      listPieces(sql),
      readHistory(sql),
      dayOf(row.look_id, sql),
    ])
    if (!look) throw new GenerationError('This look has gone.')
    if (!guide) throw new GenerationError('Draft your style guide first.')
    const problem = remakeProblem(look, ask)
    if (problem) throw new GenerationError(problem)

    const made = await draft({ profile, guide, pieces, history, look, ask, day })
    const tidy = tidyRemake(made.draft, { occasion: look.occasion, piece_ids: look.pieces.map((piece) => piece.id) }, ask, pieces, history)
    if (!tidy) {
      console.warn(JSON.stringify({ event: 'remake.not_kept', id, piece_ids: made.draft.piece_ids, ask, usd: made.usd }))
      await record(sql, id, made)
      throw new GenerationError('The remade look did not hold together. Try again.')
    }
    const done = await finishRemake(id, { ...tidy, today: day ? tidy.today : null }, made, sql)
    console.info(JSON.stringify({ event: 'remake.ready', id, look: look.id, new_look: done.lookId, usd: made.usd, ms: Date.now() - started }))
    return { ok: true, ...done }
  } catch (error) {
    const message = error instanceof GenerationError ? error.message : 'Something went wrong remaking it. Try again.'
    console.warn(JSON.stringify({ event: 'remake.failed', id, message: (error as Error).message, cause: (error as Error).cause ?? null }))
    await sql`update look_remakes set status = 'failed', error = ${message}, finished_at = now() where id = ${id} and status = 'making'`
    return { ok: false, message }
  }
}

/** The call's model and cost on the row, kept when its answer is not. */
async function record(sql: Sql, id: number, made: RemakeResult): Promise<void> {
  await sql`
    update look_remakes set ${sql({
      model: made.meta.model,
      served_by: made.meta.served_by,
      input_tokens: made.meta.input_tokens,
      output_tokens: made.meta.output_tokens,
      usd: Number(made.usd.toFixed(6)),
    })}
    where id = ${id}
  `
}

/**
 * The look already made with the remade pieces (matchingLooks), so the remake
 * is that look, its pictures and all, rather than a copy; unless it is
 * already beside the old one in a set or a day, where it would show twice.
 */
async function sameLook(tx: Sql | TransactionSql, oldId: number, look: { occasion: string; piece_ids: number[] }): Promise<number | null> {
  const existing = (await matchingLooks(tx)).get(lookKey(look))
  if (existing === undefined || existing === oldId) return null
  const beside = await tx`
    select 1 from look_set_looks a join look_set_looks b on b.set_id = a.set_id
    where a.look_id = ${oldId} and b.look_id = ${existing}
    union all
    select 1 from day_outfit_options a join day_outfit_options b on b.day_id = a.day_id
    where a.look_id = ${oldId} and b.look_id = ${existing}
    limit 1
  `
  return beside.length > 0 ? null : existing
}

/**
 * The remade look in the old one's place, in one transaction: the look
 * already made with those pieces (sameLook), else a new look in the same set
 * and position; saved if the old one was, and in the old one's place in every
 * set that offered it (look_set_looks); today's wear handed
 * over, every current day's outfit that showed the old look showing the new
 * one with its line for the day, and the old look marked replaced.
 */
export async function finishRemake(
  id: number,
  look: RemakeDraft & { occasion: Look['occasion'] },
  made: RemakeResult,
  sql: Sql = db(),
): Promise<{ lookId: number; onShow: boolean }> {
  return sql.begin(async (tx) => {
    const [old] = await tx<{ id: number; set_id: number; position: number; status: Look['status'] }[]>`
      select l.id::int as id, l.set_id::int as set_id, l.position, l.status
      from look_remakes r join looks l on l.id = r.look_id
      where r.id = ${id} and r.status = 'making'
      for update of l, r
    `
    if (!old) throw new GenerationError('It stopped part way. Try again.')
    if (old.status !== 'new' && old.status !== 'saved') throw new GenerationError('This look changed while it was being remade.')

    const lookId = (await sameLook(tx, old.id, look)) ?? (await insertLook(tx, old.set_id, old.position, look))
    if (old.status === 'saved') await tx`update looks set status = 'saved', acted_at = now() where id = ${lookId}`
    await tx`update looks set status = 'replaced', acted_at = now() where id = ${old.id}`
    await tx`update look_set_looks set look_id = ${lookId} where look_id = ${old.id}`
    await tx`
      with moved as (
        delete from look_wears where look_id = ${old.id} and worn_on = (now() at time zone 'Pacific/Auckland')::date
        returning worn_on
      )
      insert into look_wears (look_id, worn_on) select ${lookId}, worn_on from moved
      on conflict do nothing
    `
    await tx`
      update day_outfit_options o set look_id = ${lookId}, today = coalesce(${look.today}, o.today)
      from day_outfits d
      where d.id = o.day_id and o.look_id = ${old.id} and d.for_date >= (now() at time zone 'Pacific/Auckland')::date
    `
    await tx`
      update day_outfits set gym_look_id = ${lookId}, gym_today = coalesce(${look.today}, gym_today)
      where gym_look_id = ${old.id} and for_date >= (now() at time zone 'Pacific/Auckland')::date
    `
    await tx`
      update look_remakes set ${tx({
        status: 'ready',
        new_look_id: lookId,
        model: made.meta.model,
        served_by: made.meta.served_by,
        input_tokens: made.meta.input_tokens,
        output_tokens: made.meta.output_tokens,
        usd: Number(made.usd.toFixed(6)),
      })}, finished_at = now()
      where id = ${id}
    `
    const [shown] = await tx<{ on_show: boolean }[]>`
      select exists (
        select 1 from day_outfits d join day_outfit_options o on o.day_id = d.id and o.position = d.shown
        where o.look_id = ${lookId} and d.for_date = ${dressDate()} and d.status = 'ready'
      ) as on_show
    `
    return { lookId, onShow: shown?.on_show ?? false }
  })
}
