import { connection } from 'next/server'

import { ButtonLink } from '@/components/button-link'
import { Refresh } from '@/components/refresh'
import { SectionHead } from '@/components/section'
import { Bone } from '@/components/skeleton'
import { listSlots } from '@/lib/blueprint'
import { list } from '@/lib/format'
import { readDay, trainsOn, type DayLook, type DayOutfit as Day } from '@/lib/day-outfit'
import { gymReadiness, OCCASION_LABELS, readiness } from '@/lib/looks'
import { listPieces } from '@/lib/pieces'
import { getProfile } from '@/lib/profile'
import { SEASON_INFO, seasonName } from '@/lib/seasons'
import { getGuide } from '@/lib/style-guide'
import { dateLabel, dressDate, forecastLine, nzDate, nzSeason } from '@/lib/weather'

import { DayCard } from './day-card'
import { DressAgain, DressForGym } from './dress-again'
import { Starter } from './starter'

/*
 * Today. Once there is a style guide and enough of a wardrobe, the first
 * opening on a day starts its outfit (Starter) and the page waits,
 * refreshing, until Opus has put it together; after six in the evening it
 * dresses him for tomorrow. On a day he trains, a gym fit follows. Before
 * any of that exists, the page is the one next step. Nothing animates in:
 * the picture is the arrival.
 */

export async function DayOutfit() {
  await connection()
  const now = new Date()
  const date = dressDate(now)
  const isToday = date === nzDate(now)
  const [guide, pieces, day, profile, slots] = await Promise.all([getGuide(), listPieces(), readDay(date), getProfile(), listSlots()])
  const season = profile.confirmed_at ? profile.season : null

  if (!season) {
    return (
      <Step
        title="Your palette is blank."
        line="Tell Wardrobe your colouring, proportions and sizes. It drafts what you should own, then looks for it every night in Wellington shops and online."
        href={profile.analysed_at ? '/you/colouring' : '/you'}
        button={profile.analysed_at ? 'Confirm your read' : 'Start your profile'}
      />
    )
  }

  if (!guide) {
    return (
      <Step
        title={`Your palette is ${seasonName(season).toLowerCase()}.`}
        line={`${SEASON_INFO[season].traits} Next comes your style guide, then the blueprint: what to own, drafted from this read.`}
        href="/blueprint"
        button="Draft your style guide"
      />
    )
  }

  const ready = readiness(pieces)
  const when = isToday ? ('today' as const) : ('tomorrow' as const)
  const head = <DateLine date={date} forecast={day?.forecast ?? null} />

  if (!day && !ready.ready) {
    const active = pieces.filter((piece) => !piece.set_aside_at).length
    return (
      <section aria-labelledby="day">
        {head}
        <h1 id="day" className="display mt-6 text-[2.5rem] sm:text-[3.25rem]">
          What to wear {when}.
        </h1>
        <p className="prose mt-4 max-w-[42ch] text-[1.0625rem] leading-normal text-ink-2">
          Every morning this is an outfit from what you own, for Wellington&rsquo;s forecast and your day.{' '}
          {active === 0 ? 'Your wardrobe is empty: ' : `You have ${active} ${active === 1 ? 'piece' : 'pieces'}; `}
          add {list(ready.missing)} to start.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/wardrobe/new">Add a piece</ButtonLink>
          {slots.length === 0 ? (
            <ButtonLink href="/blueprint" variant="quiet">
              Draft the blueprint
            </ButtonLink>
          ) : null}
        </div>
      </section>
    )
  }

  if (!day) {
    return (
      <section aria-labelledby="day">
        {head}
        <Making when={when} />
        <Starter />
      </section>
    )
  }

  if (day.status === 'making') {
    return (
      <section aria-labelledby="day">
        {head}
        <Making when={when} note={day.note} />
        <Refresh />
      </section>
    )
  }

  if (day.status === 'failed' || day.options.length === 0) {
    return (
      <section aria-labelledby="day">
        {head}
        <h1 id="day" className="display mt-6 text-[2.5rem] sm:text-[3.25rem]">
          Nothing to wear yet.
        </h1>
        <p role="alert" className="prose mt-4 max-w-[44ch] text-[1.0625rem] leading-normal text-ink-2">
          {day.status === 'failed'
            ? (day.error ?? 'It could not be put together. Try again.')
            : 'The pieces of this outfit are gone from your wardrobe.'}
        </p>
        <div className="mt-6">
          <DressAgain when={when} open />
        </div>
      </section>
    )
  }

  const shownImageUsd = day.options[day.shown]?.image?.usd ?? null
  const canDraw = Boolean(process.env.OPENAI_API_KEY)
  return (
    <section aria-label={`What to wear ${when}`}>
      {head}
      <div className="mt-5">
        <DayCard
          key={day.id}
          dayId={day.id}
          options={day.options.map((option) => ({
            look: option.look,
            today: option.today,
            occasion: OCCASION_LABELS[option.look.occasion],
            image: option.image,
          }))}
          shown={day.shown}
          today={nzDate(now)}
          isToday={isToday}
          canDraw={canDraw}
        />
      </div>
      {/* The picture of the option on show (or of the gym fit) is being drawn: ask again until it is there. */}
      {day.options[day.shown]?.image?.status === 'making' || day.gym?.image?.status === 'making' ? <Refresh /> : null}

      {day.gym ? (
        <Gym dayId={day.id} gym={day.gym} today={nzDate(now)} isToday={isToday} canDraw={canDraw} />
      ) : trainsOn(profile, date) ? (
        <GymNotReady missing={gymReadiness(pieces).missing} when={when} />
      ) : null}

      <div className="mt-14">
        <SectionHead title={`Something on ${when}?`} />
        <div className="mt-3">
          <DressAgain when={when} />
        </div>
        {day.note ? <p className="mt-3 text-[0.8125rem] text-ink-3">This outfit is dressed for &ldquo;{day.note}&rdquo;.</p> : null}
      </div>

      <p className="mt-10 max-w-[44ch] text-[0.8125rem] leading-normal text-ink-3">
        Forecast from{' '}
        <a href="https://open-meteo.com/" className="underline decoration-line underline-offset-[3px]">
          Open-Meteo
        </a>
        . Put together by Opus{day.usd !== null ? ` for US$${day.usd.toFixed(2)}` : ''}
        {day.remake_usd > 0 ? `, its pieces changed for US$${day.remake_usd.toFixed(2)}` : ''}
        {shownImageUsd !== null ? `, drawn by OpenAI for US$${shownImageUsd.toFixed(2)}` : ''}.
      </p>
    </section>
  )
}

/** The first thing on the page: the day it is for, and the weather it is dressed for. */
function DateLine({ date, forecast }: { date: string; forecast: Day['forecast'] }) {
  const month = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-NZ', { month: 'long', timeZone: 'UTC' })
  return (
    <div>
      <p className="caption text-ink-2">
        {dateLabel(date)}, {nzSeason(date)}
      </p>
      <p className="prose mt-0.5 text-[1.0625rem] leading-normal text-ink">
        {forecast ? forecastLine(forecast) : `No forecast could be read, so a usual ${month} day in Wellington.`}
      </p>
    </div>
  )
}

/** Before the profile or the guide exists: the next step, as the page. */
function Step({ title, line, href, button }: { title: string; line: string; href: '/you' | '/you/colouring' | '/blueprint'; button: string }) {
  return (
    <section aria-labelledby="day">
      <h1 id="day" className="display mt-8 text-[2.5rem] sm:text-[3.25rem]">
        {title}
      </h1>
      <p className="prose mt-4 max-w-[40ch] text-[1.0625rem] leading-normal text-ink-2">{line}</p>
      <ButtonLink href={href} className="mt-8">
        {button}
      </ButtonLink>
    </section>
  )
}

/** The day's gym fit, under the outfit: one look, nothing to swipe. */
function Gym({ dayId, gym, today, isToday, canDraw }: { dayId: number; gym: DayLook; today: string; isToday: boolean; canDraw: boolean }) {
  return (
    <section aria-labelledby="gym" className="mt-16">
      <SectionHead id="gym" title="For the gym" />
      <div className="mt-4">
        <DayCard
          dayId={dayId}
          options={[{ look: gym.look, today: gym.today, occasion: OCCASION_LABELS.gym, image: gym.image }]}
          shown={0}
          today={today}
          isToday={isToday}
          canDraw={canDraw}
        />
      </div>
    </section>
  )
}

/**
 * A day he trains whose outfit came without a gym fit: his kit is not marked
 * yet (or it could not make one). Says what to mark, or offers a new outfit.
 */
function GymNotReady({ missing, when }: { missing: string[]; when: string }) {
  return (
    <section aria-labelledby="gym" className="mt-16">
      <SectionHead id="gym" title="For the gym" />
      <p className="prose mt-3 max-w-[44ch] text-[0.9375rem] text-ink-2">
        {missing.length > 0
          ? `You train ${when}. Mark ${list(missing)} as gym kit in your wardrobe and the next outfit comes with a gym fit.`
          : `You train ${when}, but this outfit was put together without a gym fit. Dress again and the new outfit comes with one.`}
      </p>
      {missing.length > 0 ? (
        <ButtonLink href="/wardrobe" variant="quiet" size="small" className="mt-4">
          Your pieces
        </ButtonLink>
      ) : (
        <DressForGym />
      )}
    </section>
  )
}

/** The shape of the cover to come, in the surface colour, with a line on what is happening. */
function Making({ when, note }: { when: string; note?: string | null }) {
  return (
    <div role="status" className="mt-5">
      <div aria-hidden className="bleed grid grid-cols-6 gap-px lg:mx-0 lg:max-w-[30rem]">
        <Bone className="col-span-4 row-span-2 aspect-[3/4] rounded-none" />
        <Bone className="col-span-2 h-full rounded-none" />
        <Bone className="col-span-2 h-full rounded-none" />
        <Bone className="col-span-3 h-24 rounded-none sm:h-28" />
        <Bone className="col-span-3 h-24 rounded-none sm:h-28" />
      </div>
      <p className="prose mt-5 max-w-[42ch] text-[1.0625rem] leading-normal text-ink" aria-live="polite">
        Reading the forecast and your wardrobe{note ? ` for "${note}"` : ''}, and putting {when}&rsquo;s outfit together.
      </p>
      <p className="mt-1 text-[0.9375rem] text-ink-3">About a minute. You can leave and come back.</p>
    </div>
  )
}
