'use client'

import Link from 'next/link'
import { useOptimistic, useState, useTransition, type CSSProperties } from 'react'

import { seeLookOnMe } from '@/app/try-on-actions'
import { Cloth } from '@/components/cloth'
import { PieceImage } from '@/components/piece-image'
import { TryOn } from '@/components/try-on'
import type { Look, LookAction, LookDismissReason } from '@/lib/looks'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

import { lookAction } from './actions'

/*
 * One look as a lookbook page: the pieces laid out (the outermost large, the
 * next two beside it, shoes and what is carried along the bottom), then the
 * name, the occasion and weather, why it works and how to wear it. "See it on
 * me" dresses him in the whole look. Save and "Wore it" show at once and are
 * saved behind; Dismiss asks why, then the card fades out and the next render
 * drops it.
 */

const REASONS: { value: LookDismissReason; label: string }[] = [
  { value: 'colours', label: 'Colours' },
  { value: 'too_dressy', label: 'Too dressy' },
  { value: 'too_casual', label: 'Too casual' },
  { value: 'weather', label: 'Wrong for the weather' },
  { value: 'not_me', label: 'Not me' },
]

type Shown = { saved: boolean; woreToday: boolean }

export function LookCard({
  look,
  today,
  occasion,
  wornLine,
}: {
  look: Look
  /** Today in New Zealand, YYYY-MM-DD. */
  today: string
  occasion: string
  /** "Worn 3 times, last on 2 November", formatted on the server. */
  wornLine: string | null
}) {
  const [asking, setAsking] = useState(false)
  const [gone, setGone] = useState(false)
  const [failed, setFailed] = useState(false)
  const [shown, setShown] = useOptimistic<Shown>({ saved: look.status === 'saved', woreToday: look.worn[0] === today })
  const [, startTransition] = useTransition()

  function send(input: LookAction, next?: Shown) {
    setFailed(false)
    startTransition(async () => {
      if (next) setShown(next)
      const result = await lookAction(input)
      if (!result.ok) {
        setGone(false)
        setFailed(true)
      }
    })
  }

  const missing = look.piece_count - look.pieces.length
  const asideCount = look.pieces.filter((piece) => piece.set_aside_at).length

  return (
    <article data-gone={gone} aria-hidden={gone || undefined} className="find flex flex-col">
      <FlatLay look={look} />

      <p className="mt-4 text-[0.8125rem] font-medium tracking-[0.02em] text-ink-3 uppercase">
        {occasion}
        <span aria-hidden> · </span>
        <span className="normal-case tracking-normal">{look.weather}</span>
      </p>
      <h3 className="mt-1.5 font-display text-[1.5rem] leading-[1.1] tracking-[-0.005em]">{look.title}</h3>
      <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-2">{look.why}</p>
      {look.styling ? (
        <p className="mt-2 font-display text-[1.0625rem] leading-snug italic text-ink">{look.styling}</p>
      ) : null}

      <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-0.5 text-[0.8125rem] leading-relaxed text-ink-3">
        {look.pieces.map((piece, index) => (
          <li key={piece.id}>
            <Link href={`/looks/pieces/${piece.id}`} className="underline decoration-line underline-offset-[3px] hover:text-ink-2">
              {piece.name}
            </Link>
            {piece.set_aside_at ? ' (set aside)' : ''}
            {index < look.pieces.length - 1 ? ',' : ''}
          </li>
        ))}
      </ul>
      {missing > 0 || asideCount > 0 ? (
        <p className="mt-1 text-[0.8125rem] text-alert">
          {missing > 0 ? `${missing === 1 ? 'A piece' : `${missing} pieces`} of this look ${missing === 1 ? 'is' : 'are'} no longer in your wardrobe.` : 'Part of this look is set aside.'}
        </p>
      ) : null}

      {look.better ? (
        <Link
          href={`/blueprint/${look.better.slot_id}`}
          className="pressable mt-4 -mx-2 flex items-center gap-3 rounded-xl px-2 py-2"
        >
          <span className="flex shrink-0 -space-x-1.5" aria-hidden>
            {look.better.colours.slice(0, 2).map((hex) => (
              <Cloth key={hex} colour={hex} className="h-8 w-6 rounded-[0.25rem]" />
            ))}
          </span>
          <span className="min-w-0 text-[0.875rem] leading-snug">
            <span className="text-ink-2">Even better with your </span>
            <span className="text-brass">{look.better.name.toLowerCase()}</span>
            {look.better.why ? <span className="block text-ink-3">{look.better.why}</span> : null}
          </span>
        </Link>
      ) : null}

      {wornLine ? <p className="mt-3 text-[0.8125rem] text-ink-3">{wornLine}</p> : null}

      <div className="mt-auto pt-3">
        {missing === 0 ? <LookOnMe look={look} occasion={occasion} /> : null}
        <div key={asking ? 'ask' : 'act'} className="tray">
          {asking ? (
            <div role="group" aria-label="Why dismiss it?">
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    type="button"
                    className="chip pressable"
                    onClick={() => {
                      setGone(true)
                      send({ action: 'dismiss', look_id: look.id, reason: reason.value })
                    }}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
              <button type="button" className="text-button -ml-2 mt-1 text-ink-3" onClick={() => setAsking(false)}>
                Keep it
              </button>
            </div>
          ) : (
            <div className="-ml-2 flex items-center gap-1">
              <button
                type="button"
                aria-pressed={shown.saved}
                className="text-button"
                onClick={() =>
                  send({ action: shown.saved ? 'unsave' : 'save', look_id: look.id }, { ...shown, saved: !shown.saved })
                }
              >
                {shown.saved ? <Tick /> : null}
                {shown.saved ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                aria-pressed={shown.woreToday}
                className="text-button text-ink-2"
                onClick={() =>
                  send(
                    { action: shown.woreToday ? 'unwore' : 'wore', look_id: look.id },
                    { saved: shown.woreToday ? shown.saved : true, woreToday: !shown.woreToday },
                  )
                }
              >
                {shown.woreToday ? <Tick /> : null}
                {shown.woreToday ? 'Worn today' : 'Wore it today'}
              </button>
              {shown.saved ? null : (
                <button type="button" className="text-button ml-auto text-ink-2" onClick={() => setAsking(true)}>
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
        {failed ? <p className="mt-1 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
      </div>
    </article>
  )
}

/** "See it on me" for the whole look: him dressed in it, beside the pieces it was made from. */
function LookOnMe({ look, occasion }: { look: Look; occasion: string }) {
  const unseen = look.pieces.filter((piece) => !piece.photo && !piece.image).length
  const all = unseen === look.pieces.length
  return (
    <TryOn
      initial={look.on_me}
      start={() => seeLookOnMe(look.id)}
      content={{
        eyebrow: occasion,
        title: look.title,
        alt: `You wearing ${look.title.toLowerCase()}`,
        aside: (
          <figure>
            <div className="grid grid-cols-3 gap-2">
              {look.pieces.map((piece) => (
                <PieceImage
                  key={piece.id}
                  piece={piece}
                  label={GARMENT_LABELS[piece.garment_type]}
                  sizes="(min-width: 1024px) 7rem, 30vw"
                  className="aspect-[3/4] rounded-lg"
                />
              ))}
            </div>
            <figcaption className="mt-2 text-[0.8125rem] text-ink-3">Your pieces</figcaption>
          </figure>
        ),
        note: (
          <>
            Made by OpenAI from your full-length photo and the photos of your pieces. Judge the colours against the
            pieces themselves: the picture cannot know how each one sits on you.
            {unseen === 0
              ? null
              : all
                ? ' None of these pieces has a photo yet, so each was drawn from its description.'
                : ` ${unseen === 1 ? 'One piece has' : `${unseen} pieces have`} no photo yet, so ${unseen === 1 ? 'it was' : 'they were'} drawn from the description.`}
          </>
        ),
      }}
    />
  )
}

function Tick() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

/**
 * The pieces laid out on a six-column grid: the first (outermost) large on
 * the left, the next two stacked beside it, and the rest, usually shoes and
 * what is carried, sharing a shorter row along the bottom.
 */
function FlatLay({ look }: { look: Look }) {
  const [first, second, third, ...rest] = look.pieces
  if (!first) return <div className="cloth aspect-[4/3] rounded-xl" style={{ '--swatch': 'var(--surface)' } as CSSProperties} />
  return (
    <div className="grid grid-cols-6 gap-2" aria-label={`The pieces of ${look.title}`} role="group">
      <PieceImage piece={first} label={GARMENT_LABELS[first.garment_type]} sizes="(min-width: 640px) 13rem, 60vw" className={`${second ? 'col-span-4 row-span-2' : 'col-span-6'} aspect-[3/4] rounded-xl`} />
      {second ? <PieceImage piece={second} label={GARMENT_LABELS[second.garment_type]} sizes="(min-width: 640px) 7rem, 30vw" className={`col-span-2 ${third ? '' : 'row-span-2'} h-full rounded-xl`} /> : null}
      {third ? <PieceImage piece={third} label={GARMENT_LABELS[third.garment_type]} sizes="(min-width: 640px) 7rem, 30vw" className="col-span-2 h-full rounded-xl" /> : null}
      {rest.length > 0 ? (
        <div className="col-span-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${rest.length}, minmax(0, 1fr))` }}>
          {rest.map((piece) => (
            <PieceImage key={piece.id} piece={piece} label={GARMENT_LABELS[piece.garment_type]} sizes="(min-width: 640px) 9rem, 30vw" className="h-24 rounded-xl sm:h-28" />
          ))}
        </div>
      ) : null}
    </div>
  )
}
