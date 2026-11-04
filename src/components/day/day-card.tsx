'use client'

import Link from 'next/link'
import { useOptimistic, useState, useTransition } from 'react'

import { lookAction } from '@/app/(app)/looks/actions'
import { drawLook, nextOption } from '@/app/day-actions'
import { FlatLay, LookOnMe, Tick } from '@/components/look-parts'
import { PieceImage } from '@/components/piece-image'
import type { LookImage } from '@/lib/look-image'
import type { Look, LookAction } from '@/lib/looks'

/*
 * The day's outfit as a lookbook page: its picture (a flat lay OpenAI draws
 * from the pieces, with the pieces themselves in a row under it to judge the
 * colours against), or the pieces laid out until it is drawn; the occasion and
 * the kind of day, the name, why it suits this day (the forecast, what is
 * on), why it works on him, how to wear it. "Wore it today" logs it (and
 * saves it, as on the Looks tab); "Another" turns to the next option at once
 * and tells the server behind, so every device opens on the same one.
 */

export type DayCardOption = { look: Look; today: string; occasion: string; image: LookImage | null }

export function DayCard({
  dayId,
  options,
  shown,
  today,
  isToday,
  canDraw,
}: {
  dayId: number
  options: DayCardOption[]
  shown: number
  /** Today in New Zealand, YYYY-MM-DD. */
  today: string
  /** False when it dresses him for tomorrow: nothing to log as worn yet. */
  isToday: boolean
  /** Whether the server can draw pictures (it has an OpenAI key). */
  canDraw: boolean
}) {
  const [index, setIndex] = useOptimistic(shown)
  const [, startTransition] = useTransition()
  const option = options[index % options.length]!
  const { look } = option

  function next() {
    startTransition(async () => {
      setIndex((index + 1) % options.length)
      await nextOption(dayId)
    })
  }

  return (
    <article aria-roledescription="outfit" aria-label={look.title}>
      {/* A new option crossfades in; nothing moves. */}
      <div key={look.id} className="tray">
        <Picture look={look} image={option.image} canDraw={canDraw} />

        <p className="mt-4 text-[0.8125rem] font-medium tracking-[0.02em] text-ink-3 uppercase">
          {option.occasion}
          <span aria-hidden> · </span>
          <span className="normal-case tracking-normal">{look.weather}</span>
        </p>
        <h3 className="mt-1.5 font-display text-[1.5rem] leading-[1.1] tracking-[-0.005em]">{look.title}</h3>
        <p className="mt-2.5 text-[1rem] leading-relaxed text-ink">{option.today}</p>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">{look.why}</p>
        {look.styling ? (
          <p className="mt-2 font-display text-[1.0625rem] leading-snug italic text-ink">{look.styling}</p>
        ) : null}

        <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-0.5 text-[0.8125rem] leading-relaxed text-ink-3">
          {look.pieces.map((piece, position) => (
            <li key={piece.id}>
              <Link href={`/looks/pieces/${piece.id}`} className="underline decoration-line underline-offset-[3px] hover:text-ink-2">
                {piece.name}
              </Link>
              {position < look.pieces.length - 1 ? ',' : ''}
            </li>
          ))}
        </ul>
      </div>

      {/* Keyed by the look, so each option keeps its own try-on and its own saved and worn state. */}
      <div key={`actions-${look.id}`} className="mt-3">
        {look.pieces.length === look.piece_count ? <LookOnMe look={look} occasion={option.occasion} /> : null}
        <Actions
          look={look}
          today={today}
          isToday={isToday}
          another={options.length > 1 ? { label: `${index + 1} of ${options.length}`, onClick: next } : null}
        />
      </div>
    </article>
  )
}

type Shown = { saved: boolean; woreToday: boolean }

/** Wore it today, Save, and Another: the first two show at once and are saved behind. */
function Actions({
  look,
  today,
  isToday,
  another,
}: {
  look: Look
  today: string
  isToday: boolean
  another: { label: string; onClick: () => void } | null
}) {
  const [failed, setFailed] = useState(false)
  const [shown, setShown] = useOptimistic<Shown>({ saved: look.status === 'saved', woreToday: look.worn[0] === today })
  const [, startTransition] = useTransition()

  function send(input: LookAction, next: Shown) {
    setFailed(false)
    startTransition(async () => {
      setShown(next)
      const result = await lookAction(input)
      if (!result.ok) setFailed(true)
    })
  }

  return (
    <>
      <div className="-ml-2 flex items-center gap-1">
        {isToday ? (
          <button
            type="button"
            aria-pressed={shown.woreToday}
            className="text-button"
            onClick={() =>
              send(
                { action: shown.woreToday ? 'unwore' : 'wore', look_id: look.id },
                { saved: shown.woreToday ? shown.saved : true, woreToday: !shown.woreToday },
              )
            }
          >
            {shown.woreToday ? <Tick /> : null}
            {shown.woreToday ? 'Wearing it' : 'Wear this'}
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={shown.saved}
          className={`text-button ${isToday ? 'text-ink-2' : ''}`}
          onClick={() => send({ action: shown.saved ? 'unsave' : 'save', look_id: look.id }, { ...shown, saved: !shown.saved })}
        >
          {shown.saved ? <Tick /> : null}
          {shown.saved ? 'Saved' : 'Save'}
        </button>
        {another ? (
          <button type="button" className="text-button ml-auto text-ink-2" onClick={another.onClick}>
            Another
            <span className="font-normal text-ink-3 tabular-nums">{another.label}</span>
          </button>
        ) : null}
      </div>
      {failed ? <p className="mt-1 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
    </>
  )
}

/**
 * The drawn flat lay once it is ready, with the pieces in a row under it; the
 * pieces laid out while it is drawn (saying so) or when it could not be.
 */
function Picture({ look, image, canDraw }: { look: Look; image: LookImage | null; canDraw: boolean }) {
  if (image?.status === 'ready' && image.width && image.height) {
    return (
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it */}
        <img
          src={`/photos/looks/${image.id}`}
          alt={`${look.title}, laid out`}
          width={image.width}
          height={image.height}
          className="aspect-[3/4] w-full rounded-xl bg-surface object-cover"
        />
        <div className="mt-2 flex gap-2" role="group" aria-label="The pieces themselves">
          {look.pieces.map((piece) => (
            <PieceImage key={piece.id} piece={piece} sizes="3rem" className="h-16 w-12 shrink-0 rounded-md" />
          ))}
        </div>
        <figcaption className="mt-2 text-[0.8125rem] text-ink-3">
          Drawn by OpenAI from your pieces. Judge the colours against the pieces themselves.
        </figcaption>
      </figure>
    )
  }
  return (
    <div>
      <div className="relative">
        <FlatLay look={look} />
        {image?.status === 'making' ? (
          <p role="status" className="absolute top-3 left-3 rounded-full bg-ground/85 px-3 py-1.5 text-[0.8125rem] font-medium text-ink-2">
            Drawing the outfit
          </p>
        ) : null}
      </div>
      {canDraw && image?.status !== 'making' ? <Draw lookId={look.id} failed={image?.status === 'failed' ? image.error : null} /> : null}
    </div>
  )
}

/** Draw the picture, when it has none or the last one failed. */
function Draw({ lookId, failed }: { lookId: number; failed: string | null }) {
  const [pending, startTransition] = useTransition()
  function start() {
    startTransition(async () => {
      await drawLook(lookId)
    })
  }
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-ink-3">
      {failed ? <span>The picture could not be drawn. {failed}</span> : null}
      <button type="button" disabled={pending} className="text-button -ml-2 min-h-9 text-[0.8125rem]" onClick={start}>
        {pending ? 'Starting' : failed ? 'Draw it again' : 'Draw the outfit'}
      </button>
    </p>
  )
}
