'use client'

import Link from 'next/link'
import { useState, useTransition, type ReactNode } from 'react'

import { PieceImage } from '@/components/piece-image'
import type { Look } from '@/lib/looks'
import type { Piece } from '@/lib/pieces'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

import { lookAction, setAsideRow } from './actions'
import { REASONS } from './look-card'

/*
 * The Worn page's rows: a look or a piece, how often it was offered and
 * worn, and the one way to discard it. Dismiss asks why, as a look card
 * does; Set aside asks what becomes of the piece's slot, as its page does.
 * Either way the row fades at once and the next render drops it; if the
 * action fails it comes back with a line saying so.
 */

const LINK = 'underline decoration-line underline-offset-[3px] hover:text-ink-2'

/** A row: the picture beside the words, or above them on the phone when it is a strip too wide to sit beside. */
function Row({
  gone,
  stack = false,
  picture,
  children,
}: {
  gone: boolean
  stack?: boolean
  picture: ReactNode
  children: ReactNode
}) {
  return (
    <li
      data-gone={gone}
      aria-hidden={gone || undefined}
      className={`find flex border-t border-line py-5 ${stack ? 'flex-col gap-3 sm:flex-row sm:gap-5' : 'gap-4 sm:gap-5'}`}
    >
      <div className="shrink-0">{picture}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  )
}

/** Ask, then act: the button that opens a row's choices, the choices, and "Keep it". */
function Discard({
  label,
  question,
  hint,
  choices,
  onChoose,
  failed,
}: {
  label: string
  question: string
  hint?: string
  choices: { value: string; label: string }[]
  onChoose: (value: string) => void
  failed: boolean
}) {
  const [asking, setAsking] = useState(false)
  return (
    <div key={asking ? 'ask' : 'act'} className="tray mt-2">
      {asking ? (
        <div role="group" aria-label={question}>
          {hint ? <p className="mb-2 text-[0.8125rem] text-ink-3">{hint}</p> : null}
          <div className="flex flex-wrap gap-1.5">
            {choices.map((choice) => (
              <button key={choice.value} type="button" className="chip pressable" onClick={() => onChoose(choice.value)}>
                {choice.label}
              </button>
            ))}
          </div>
          <button type="button" className="text-button -ml-2 mt-1 text-ink-3" onClick={() => setAsking(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" className="text-button -ml-2 text-ink-2" onClick={() => setAsking(true)}>
          {label}
        </button>
      )}
      {failed ? <p className="mt-2 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
    </div>
  )
}

/** A look: its pieces in a strip, its name, how it has done, and Dismiss. */
export function WornLook({ look, occasion, line }: { look: Look; occasion: string; line: string }) {
  const [gone, setGone] = useState(false)
  const [failed, setFailed] = useState(false)
  const [, startTransition] = useTransition()
  const aside = look.pieces.some((piece) => piece.set_aside_at) || look.pieces.length < look.piece_count

  return (
    <Row
      gone={gone}
      stack
      picture={
        <div className="flex gap-px overflow-hidden rounded-[var(--radius-tile)]" role="group" aria-label={`The pieces of ${look.title}`}>
          {look.pieces.slice(0, 6).map((piece) => (
            <PieceImage
              key={piece.id}
              piece={piece}
              sizes="3rem"
              className="aspect-[3/4] w-11 sm:w-12"
            />
          ))}
        </div>
      }
    >
      <p className="caption">
        {occasion}
        {aside ? ', part of it no longer in your wardrobe' : ''}
      </p>
      <h3 className="title mt-1">{look.title}</h3>
      <p className="mt-1.5 text-[0.875rem] leading-snug text-ink-2">{line}</p>
      <Discard
        label="Dismiss"
        question="Why dismiss it?"
        choices={REASONS}
        failed={failed}
        onChoose={(reason) => {
          setGone(true)
          setFailed(false)
          startTransition(async () => {
            const result = await lookAction({ action: 'dismiss', look_id: look.id, reason: reason as (typeof REASONS)[number]['value'] })
            if (!result.ok) {
              setGone(false)
              setFailed(true)
            }
          })
        }}
      />
    </Row>
  )
}

/** A piece: its picture, its name, how it has done, and Set aside. */
export function WornPiece({ piece, colour, line }: { piece: Piece; colour: string | null; line: string }) {
  const [gone, setGone] = useState(false)
  const [failed, setFailed] = useState(false)
  const [, startTransition] = useTransition()
  const slot = piece.slot_id && piece.slot_name ? piece.slot_name.toLowerCase() : null

  return (
    <Row
      gone={gone}
      picture={
        <Link href={`/wardrobe/${piece.id}`} className="pressable block rounded-[var(--radius-tile)]" tabIndex={-1} aria-hidden>
          <PieceImage piece={piece} colour={colour} sizes="4rem" className="aspect-[3/4] w-14 rounded-[var(--radius-tile)] sm:w-16" />
        </Link>
      }
    >
      <p className="caption">{GARMENT_LABELS[piece.garment_type]}</p>
      <h3 className="title mt-1">
        <Link href={`/wardrobe/${piece.id}`} className={LINK}>
          {piece.name}
        </Link>
      </h3>
      <p className="mt-1.5 text-[0.875rem] leading-snug text-ink-2">{line}</p>
      <Discard
        label="Set aside"
        question="Set it aside?"
        hint={slot ? `It fills your ${slot} slot.` : 'Looks will leave it out. It stays on record.'}
        choices={slot ? [{ value: 'wanted', label: 'Set aside, find another' }, { value: 'retired', label: 'Set aside, retire the slot' }] : [{ value: 'wanted', label: 'Set it aside' }]}
        failed={failed}
        onChoose={(slotTo) => {
          setGone(true)
          setFailed(false)
          startTransition(async () => {
            const result = await setAsideRow({ piece_id: piece.id, slot_to: slotTo === 'retired' ? 'retired' : 'wanted' })
            if (!result.ok) {
              setGone(false)
              setFailed(true)
            }
          })
        }}
      />
    </Row>
  )
}
