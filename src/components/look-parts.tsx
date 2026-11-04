'use client'

import type { CSSProperties } from 'react'

import { seeLookOnMe } from '@/app/try-on-actions'
import { PieceImage } from '@/components/piece-image'
import { TryOn } from '@/components/try-on'
import type { Look } from '@/lib/looks'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

/*
 * The parts of a look shared by its card on the Looks tab and the outfit of
 * the day on Today: the pieces laid out, "See it on me" for the whole look,
 * and the tick a done action shows.
 */

/** "See it on me" for the whole look: him dressed in it, beside the pieces it was made from. */
export function LookOnMe({ look, occasion }: { look: Look; occasion: string }) {
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

export function Tick() {
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
export function FlatLay({ look }: { look: Look }) {
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
