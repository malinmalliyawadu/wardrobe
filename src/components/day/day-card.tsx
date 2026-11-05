'use client'

import Link from 'next/link'
import { useOptimistic, useRef, useState, useTransition } from 'react'

import { lookAction } from '@/app/(app)/wardrobe/actions'
import { drawLook, turnTo } from '@/app/day-actions'
import { ChangePieces } from '@/components/change-pieces'
import { TickIcon } from '@/components/icons'
import { FlatLay, LookOnMe } from '@/components/look-parts'
import { PieceImage } from '@/components/piece-image'
import type { LookImage } from '@/lib/look-image'
import type { Look, LookAction } from '@/lib/looks'

/*
 * The day's outfit as a lookbook spread: the picture (a flat lay OpenAI
 * draws from the pieces, or the pieces laid out until it is drawn) on the
 * left, and beside it the occasion, the name set big, why it suits the day,
 * why it works on him, how to wear it, and "Wear this". The other options
 * sit under the words as small pictures; a tap turns the spread to one of
 * them at once and tells the server behind, so every device opens on the
 * same one, and it gets its picture drawn. "Change pieces" turns the list of
 * pieces into the way to swap or remove some (ChangePieces); the remade look
 * takes the option's place and, on show, gets its picture drawn.
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
  /** The look whose pieces are being changed: a remade look comes back closed. */
  const [changingId, setChangingId] = useState<number | null>(null)
  const [, startTransition] = useTransition()
  const top = useRef<HTMLDivElement>(null)
  const option = options[index % options.length]!
  const others = options.map((other, position) => ({ ...other, position })).filter((other) => other.position !== index)
  const whole = option.look.pieces.length === option.look.piece_count
  const changing = changingId === option.look.id || option.look.remaking !== null

  function turn(next: number) {
    if (next === index) return
    startTransition(async () => {
      setIndex(next)
      await turnTo(dayId, next)
    })
    // The spread is tall on the phone: come back to its top for the new one.
    top.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }

  return (
    <div ref={top} className="scroll-mt-4">
      {/* A new option crossfades in; nothing moves. */}
      <article
        key={option.look.id}
        aria-roledescription="outfit"
        aria-label={option.look.title}
        className="tray lg:grid lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start lg:gap-12"
      >
        <Picture look={option.look} image={option.image} canDraw={canDraw} />

        <div className="pt-5 lg:pt-1">
          <p className="caption">
            {option.occasion}, {option.look.weather.toLowerCase()}
          </p>
          <h2 className="display mt-1.5 text-[2.5rem] sm:text-[3.25rem] xl:text-[3.75rem]">{option.look.title}</h2>
          <p className="prose mt-5 max-w-[46ch] text-[1.0625rem] leading-normal text-ink lg:text-[1.125rem]">{option.today}</p>
          <p className="prose mt-3 max-w-[46ch] text-[0.9375rem] leading-normal text-ink-2 lg:text-[1rem]">{option.look.why}</p>
          {option.look.styling ? (
            <p className="prose mt-3 max-w-[46ch] text-[0.9375rem] leading-normal text-ink-2 italic lg:text-[1rem]">{option.look.styling}</p>
          ) : null}

          {changing ? (
            <div className="max-w-[30rem]">
              <ChangePieces look={option.look} onClose={() => setChangingId(null)} />
            </div>
          ) : (
            <>
              <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-3">
                {option.look.pieces.map((piece, position) => (
                  <span key={piece.id}>
                    <Link href={`/wardrobe/${piece.id}`} className="underline decoration-line underline-offset-[3px]">
                      {piece.name}
                    </Link>
                    {position < option.look.pieces.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
              {whole ? (
                <button
                  type="button"
                  className="text-button -ml-2 min-h-9 text-[0.8125rem]"
                  onClick={() => setChangingId(option.look.id)}
                >
                  Change pieces
                </button>
              ) : null}

              {/* Keyed by the look, so each option keeps its own saved and worn state and its own try-on. */}
              <Actions key={`actions-${option.look.id}`} look={option.look} today={today} isToday={isToday} />
              {whole ? (
                <div className="mt-2">
                  <LookOnMe key={`on-me-${option.look.id}`} look={option.look} occasion={option.occasion} />
                </div>
              ) : null}
            </>
          )}

          {others.length > 0 ? (
            <div className="mt-10" role="group" aria-label="The other options">
              <p className="caption">Or, for the same day</p>
              <ul className="mt-3 grid grid-cols-2 gap-4 sm:max-w-md">
                {others.map((other) => (
                  <li key={other.look.id}>
                    <button
                      type="button"
                      onClick={() => turn(other.position)}
                      className="pressable flex w-full items-center gap-3 text-left"
                    >
                      <Thumb option={other} />
                      <span className="min-w-0">
                        <span className="title block text-[0.9375rem] leading-snug">{other.look.title}</span>
                        <span className="caption mt-0.5 block">{other.occasion}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  )
}

/** One of the other options, small: its drawn picture if it has one, else its first two pieces. */
function Thumb({ option }: { option: DayCardOption }) {
  const { look, image } = option
  if (image?.status === 'ready' && image.width && image.height) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it
      <img
        src={`/photos/looks/${image.id}`}
        alt=""
        width={image.width}
        height={image.height}
        loading="lazy"
        className="aspect-[4/5] w-16 shrink-0 rounded-[var(--radius-tile)] bg-surface object-cover"
      />
    )
  }
  const [first, second] = look.pieces
  return (
    <span className="grid aspect-[4/5] w-16 shrink-0 grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-tile)]" aria-hidden>
      {first ? <PieceImage piece={first} sizes="2rem" className={`h-full ${second ? '' : 'col-span-2'}`} /> : <span className="bone h-full" />}
      {second ? <PieceImage piece={second} sizes="2rem" className="h-full" /> : null}
    </span>
  )
}

type Shown = { saved: boolean; woreToday: boolean }

/** Wear this and Save: both show at once and are saved behind. */
function Actions({ look, today, isToday }: { look: Look; today: string; isToday: boolean }) {
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
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        {isToday ? (
          <button
            type="button"
            aria-pressed={shown.woreToday}
            className={`btn ${shown.woreToday ? 'btn-quiet' : 'btn-primary'}`}
            onClick={() =>
              send(
                { action: shown.woreToday ? 'unwore' : 'wore', look_id: look.id },
                { saved: shown.woreToday ? shown.saved : true, woreToday: !shown.woreToday },
              )
            }
          >
            {shown.woreToday ? <TickIcon /> : null}
            {shown.woreToday ? 'Wearing it' : 'Wear this'}
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={shown.saved}
          className="btn btn-quiet"
          onClick={() => send({ action: shown.saved ? 'unsave' : 'save', look_id: look.id }, { ...shown, saved: !shown.saved })}
        >
          {shown.saved ? <TickIcon /> : null}
          {shown.saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {failed ? <p className="mt-2 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
    </div>
  )
}

/**
 * The drawn flat lay once it is ready, with the pieces in a row under it; the
 * pieces laid out while it is drawn (saying so) or when it could not be.
 */
function Picture({ look, image, canDraw }: { look: Look; image: LookImage | null; canDraw: boolean }) {
  if (image?.status === 'ready' && image.width && image.height) {
    return (
      <figure className="bleed lg:mx-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it */}
        <img
          src={`/photos/looks/${image.id}`}
          alt={`${look.title}, laid out`}
          width={image.width}
          height={image.height}
          className="aspect-[4/5] w-full bg-surface object-cover lg:rounded-[var(--radius-tile)]"
        />
        <div className="mt-px flex gap-px px-[var(--gutter)] lg:px-0" role="group" aria-label="The pieces themselves">
          {look.pieces.map((piece) => (
            <PieceImage key={piece.id} piece={piece} sizes="3rem" className="h-14 w-11 shrink-0" />
          ))}
        </div>
        <figcaption className="mt-2 px-[var(--gutter)] text-[0.8125rem] text-ink-3 lg:px-0">
          Drawn by OpenAI from your pieces. Judge the colours against the pieces themselves.
        </figcaption>
      </figure>
    )
  }
  return (
    <div className="bleed lg:mx-0">
      <FlatLay look={look} className="lg:overflow-hidden lg:rounded-[var(--radius-tile)]" />
      <div className="px-[var(--gutter)] lg:px-0">
        {image?.status === 'making' ? (
          <p role="status" className="mt-2 text-[0.8125rem] text-ink-3">
            Drawing the outfit.
          </p>
        ) : canDraw ? (
          <Draw lookId={look.id} failed={image?.status === 'failed' ? image.error : null} />
        ) : null}
      </div>
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
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-ink-3">
      {failed ? <span>The picture could not be drawn. {failed}</span> : null}
      <button type="button" disabled={pending} className="text-button -ml-2 min-h-9 text-[0.8125rem]" onClick={start}>
        {pending ? 'Starting' : failed ? 'Draw it again' : 'Draw the outfit'}
      </button>
    </p>
  )
}
