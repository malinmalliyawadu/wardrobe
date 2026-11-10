'use client'

import Link from 'next/link'
import { useOptimistic, useState, useTransition } from 'react'

import { ChangePieces } from '@/components/change-pieces'
import { Swatch } from '@/components/cloth'
import { TickIcon } from '@/components/icons'
import { FlatLay, LookOnMe } from '@/components/look-parts'
import type { Look, LookAction, LookDismissReason } from '@/lib/looks'

import { lookAction } from './actions'

/*
 * One look as a lookbook page: the pieces laid out (the outermost large, the
 * next two beside it, shoes and what is carried along the bottom), then the
 * occasion and weather, the name, why it works and how to wear it. "See it
 * on me" dresses him in the whole look. Save and "Wore it" show at once and
 * are saved behind; Dismiss asks why, then the card fades out and the next
 * render drops it. "Change pieces" turns the list of pieces into the way to
 * swap or remove some (ChangePieces), and the remade look takes this card's
 * place.
 */

/** Why he dismissed a look, as the chips say it. The Worn page asks the same. */
export const REASONS: { value: LookDismissReason; label: string }[] = [
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
  wide = false,
}: {
  look: Look
  /** Today in New Zealand, YYYY-MM-DD. */
  today: string
  occasion: string
  /** "Offered 4 times, 2 on Today. Worn twice, last on 2 November.", formatted on the server. */
  wornLine: string | null
  /** On its own on a page: a spread on the laptop, the pieces on the left and the words beside them. */
  wide?: boolean
}) {
  const [asking, setAsking] = useState(false)
  const [gone, setGone] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
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
  const changing = open || look.remaking !== null

  return (
    <article
      data-gone={gone}
      aria-hidden={gone || undefined}
      className={`find flex flex-col ${wide ? 'lg:grid lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start lg:gap-12' : ''}`}
    >
      <FlatLay look={look} className={wide ? 'bleed lg:mx-0 lg:overflow-hidden lg:rounded-[var(--radius-tile)]' : ''} />

      <div className={`flex min-w-0 flex-1 flex-col ${wide ? 'max-w-[34rem]' : ''}`}>
        <p className={`caption mt-4 ${wide ? 'lg:mt-1' : ''}`}>
          {occasion}, {look.weather}
        </p>
        <h3 className={wide ? 'display mt-1.5 text-[2.5rem] sm:text-[3.25rem]' : 'headline mt-2 text-[1.5rem]'}>{look.title}</h3>
        <p className={`text-[0.9375rem] leading-relaxed text-ink-2 ${wide ? 'mt-5 lg:text-[1rem]' : 'mt-3'}`}>{look.why}</p>
        {look.styling ? <p className={`mt-2 text-[0.9375rem] leading-snug text-ink-2 italic ${wide ? 'lg:text-[1rem]' : ''}`}>{look.styling}</p> : null}

        {changing ? (
          <ChangePieces look={look} onClose={() => setOpen(false)} />
        ) : (
          <div>
            <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-0.5 text-[0.8125rem] leading-relaxed text-ink-3">
              {look.pieces.map((piece, index) => (
                <li key={piece.id}>
                  <Link href={`/wardrobe/${piece.id}`} className="underline decoration-line underline-offset-[3px] hover:text-ink-2">
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
            {missing === 0 ? (
              <button type="button" className="text-button -ml-2 min-h-9 text-[0.8125rem]" onClick={() => setOpen(true)}>
                Change pieces
              </button>
            ) : null}
          </div>
        )}

        {look.better ? (
          <Link
            href={`/blueprint/${look.better.slot_id}`}
            className="pressable mt-4 -mx-2 flex items-center gap-3 rounded-[var(--radius-control)] px-2 py-2"
          >
            <span className="flex shrink-0 gap-0.5" aria-hidden>
              {look.better.colours.slice(0, 2).map((hex, index) => (
                <Swatch key={hex} colour={hex} name={look.better?.colour_names[index]} className="h-8 w-6" />
              ))}
            </span>
            <span className="min-w-0 text-[0.875rem] leading-snug">
              <span className="text-ink-2">Even better with your </span>
              <span className="text-accent">{look.better.name.toLowerCase()}</span>
              {look.better.why ? <span className="block text-ink-3">{look.better.why}</span> : null}
            </span>
          </Link>
        ) : null}

        {wornLine ? <p className="caption mt-3">{wornLine}</p> : null}

        <div className="mt-auto pt-4" hidden={changing}>
          {missing === 0 ? <LookOnMe look={look} occasion={occasion} /> : null}
          <div key={asking ? 'ask' : 'act'} className="tray mt-2">
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
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={shown.saved}
                  className="btn btn-quiet btn-small"
                  onClick={() =>
                    send({ action: shown.saved ? 'unsave' : 'save', look_id: look.id }, { ...shown, saved: !shown.saved })
                  }
                >
                  {shown.saved ? <TickIcon className="text-accent" /> : null}
                  {shown.saved ? 'Saved' : 'Save'}
                </button>
                <button
                  type="button"
                  aria-pressed={shown.woreToday}
                  className="btn btn-quiet btn-small"
                  onClick={() =>
                    send(
                      { action: shown.woreToday ? 'unwore' : 'wore', look_id: look.id },
                      { saved: shown.woreToday ? shown.saved : true, woreToday: !shown.woreToday },
                    )
                  }
                >
                  {shown.woreToday ? <TickIcon className="text-accent" /> : null}
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
          {failed ? <p className="mt-2 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
        </div>
      </div>
    </article>
  )
}
