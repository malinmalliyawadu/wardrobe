import { connection } from 'next/server'
import type { ReactNode } from 'react'

import { ButtonLink } from '@/components/button-link'
import { Refresh } from '@/components/refresh'
import { Bone } from '@/components/skeleton'
import { readDay, type DayOutfit as Day } from '@/lib/day-outfit'
import { OCCASION_LABELS, readiness } from '@/lib/looks'
import { listPieces } from '@/lib/pieces'
import { getGuide } from '@/lib/style-guide'
import { dateLabel, dressDate, forecastLine, nzDate, nzSeason } from '@/lib/weather'

import { DayCard } from './day-card'
import { DressAgain } from './dress-again'
import { Starter } from './starter'

/*
 * The outfit of the day on Today, between the hero and the finds. Once there
 * is a style guide and enough of a wardrobe, the first opening of Today on a
 * day starts its outfit (Starter) and the section waits, refreshing, until
 * Opus has put it together; after six in the evening it dresses him for
 * tomorrow. Nothing here animates in: the swatch fan is the page's one
 * entrance.
 */

export async function DayOutfit() {
  await connection()
  const now = new Date()
  const date = dressDate(now)
  const isToday = date === nzDate(now)
  const [guide, pieces, day] = await Promise.all([getGuide(), listPieces(), readDay(date)])
  // Until there is a guide the hero says what comes first.
  if (!guide) return null
  const ready = readiness(pieces)
  const when = isToday ? ('today' as const) : ('tomorrow' as const)

  if (!day && !ready.ready) {
    const active = pieces.filter((piece) => !piece.set_aside_at).length
    return (
      <Frame date={date} heading={`What to wear ${when}`}>
        <p className="mt-2 max-w-[42ch] text-[0.9375rem] text-ink-2">
          Every morning this is an outfit from what you own, for Wellington&rsquo;s forecast and your day.{' '}
          {active === 0 ? 'Your wardrobe is empty: ' : `You have ${active} ${active === 1 ? 'piece' : 'pieces'}; `}
          add {list(ready.missing)} to start.
        </p>
        <ButtonLink href="/looks/pieces/new" variant="quiet" className="mt-5">
          Add a piece
        </ButtonLink>
      </Frame>
    )
  }

  if (!day) {
    return (
      <Frame date={date} heading={`What to wear ${when}`}>
        <Making when={when} />
        <Starter />
      </Frame>
    )
  }

  const weather = <Weather day={day} />

  if (day.status === 'making') {
    return (
      <Frame date={date} heading={`What to wear ${when}`} weather={weather}>
        <Making when={when} note={day.note} />
        <Refresh />
      </Frame>
    )
  }

  if (day.status === 'failed' || day.options.length === 0) {
    return (
      <Frame date={date} heading={`What to wear ${when}`} weather={weather}>
        <p role="alert" className="mt-6 max-w-[44ch] text-[0.9375rem] text-ink">
          {day.status === 'failed'
            ? (day.error ?? 'It could not be put together. Try again.')
            : 'The pieces of this outfit are gone from your wardrobe.'}
        </p>
        <div className="mt-5">
          <DressAgain when={when} open />
        </div>
      </Frame>
    )
  }

  const shownImageUsd = day.options[day.shown]?.image?.usd ?? null
  return (
    <Frame date={date} heading={`What to wear ${when}`} weather={weather}>
      <div className="mt-8">
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
          canDraw={Boolean(process.env.OPENAI_API_KEY)}
        />
      </div>
      {/* The picture of the option on show is being drawn: ask again until it is there. */}
      {day.options[day.shown]?.image?.status === 'making' ? <Refresh /> : null}
      {day.note ? <p className="mt-6 text-[0.8125rem] text-ink-3">Dressed for &ldquo;{day.note}&rdquo;.</p> : null}
      <div className="mt-4">
        <DressAgain when={when} />
      </div>
      <p className="mt-4 text-[0.8125rem] text-ink-3">
        Forecast from{' '}
        <a href="https://open-meteo.com/" className="underline decoration-line underline-offset-[3px] hover:text-ink-2">
          Open-Meteo
        </a>
        . Put together by Opus{day.usd !== null ? ` for US$${day.usd.toFixed(2)}` : ''}
        {shownImageUsd !== null ? `, drawn by OpenAI for US$${shownImageUsd.toFixed(2)}` : ''}.
      </p>
    </Frame>
  )
}

function Frame({ date, heading, weather, children }: { date: string; heading: string; weather?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="day" className="mt-16 border-t border-line pt-8">
      <p className="text-[0.8125rem] font-medium tracking-[0.02em] text-ink-3 uppercase">
        {dateLabel(date)}
        <span aria-hidden> · </span>
        {nzSeason(date)}
      </p>
      <h2 id="day" className="mt-1.5 font-display text-[1.75rem] leading-tight tracking-[-0.01em]">
        {heading}
      </h2>
      {weather}
      {children}
    </section>
  )
}

/** The forecast it was dressed for, or the month's usual weather when none could be read. */
function Weather({ day }: { day: Day }) {
  if (day.forecast) {
    return <p className="mt-2 max-w-[44ch] text-[0.9375rem] text-ink-2">{forecastLine(day.forecast)}</p>
  }
  const month = new Date(`${day.for_date}T12:00:00Z`).toLocaleDateString('en-NZ', { month: 'long', timeZone: 'UTC' })
  return (
    <p className="mt-2 max-w-[44ch] text-[0.9375rem] text-ink-2">
      No forecast could be read, so it is dressed for a usual {month} day in Wellington.
    </p>
  )
}

/** The shape of the outfit to come, in the surface colour, with a line on what is happening. */
function Making({ when, note }: { when: string; note?: string | null }) {
  return (
    <div role="status" className="mt-8">
      <p className="text-[0.9375rem] text-ink-2" aria-live="polite">
        Reading the forecast and your wardrobe{note ? ` for "${note}"` : ''}, and putting {when}&rsquo;s outfit
        together. About a minute; you can leave and come back.
      </p>
      <div aria-hidden className="mt-6 grid grid-cols-6 gap-2">
        <Bone className="col-span-4 row-span-2 aspect-[3/4] rounded-xl" />
        <Bone className="col-span-2 h-full rounded-xl" />
        <Bone className="col-span-2 h-full rounded-xl" />
        <Bone className="col-span-3 h-24 rounded-xl sm:h-28" />
        <Bone className="col-span-3 h-24 rounded-xl sm:h-28" />
      </div>
    </div>
  )
}

/** "two tops, a pair of trousers and a pair of shoes" */
function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
