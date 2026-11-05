'use client'

import type { CSSProperties } from 'react'

import { seeLookOnMe } from '@/app/try-on-actions'
import { PieceImage } from '@/components/piece-image'
import { TryOn } from '@/components/try-on'
import type { Look } from '@/lib/looks'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

/** The tick a done action shows; the icon under its old name, for the look card. */
export { TickIcon as Tick } from '@/components/icons'

/*
 * The parts of a look shared by its card in the wardrobe and the outfit of
 * the day on Today: the pieces laid out, and "See it on me" for the whole look.
 */

/** "See it on me" for the whole look: him dressed in it, beside the pieces it was made from. */
export function LookOnMe({ look, occasion }: { look: Look; occasion: string }) {
  const unseen = look.pieces.filter((piece) => !piece.photo && !piece.image).length
  const all = unseen === look.pieces.length
  return (
    <TryOn
      initial={look.on_me}
      start={(again) => seeLookOnMe(look.id, again)}
      content={{
        eyebrow: occasion,
        title: look.title,
        alt: `You wearing ${look.title.toLowerCase()}`,
        aside: (
          <figure>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-tile)]">
              {look.pieces.map((piece) => (
                <PieceImage
                  key={piece.id}
                  piece={piece}
                  label={GARMENT_LABELS[piece.garment_type]}
                  sizes="(min-width: 1024px) 7rem, 30vw"
                  className="aspect-[3/4]"
                />
              ))}
            </div>
            <figcaption className="caption mt-2">Your pieces</figcaption>
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

/**
 * The pieces laid out on a six-column grid with hairline gaps, like a
 * contact sheet: the first (outermost) large on the left, the next two
 * stacked beside it, and the rest, usually shoes and what is carried,
 * sharing a shorter row along the bottom. Square-cornered, so it can run to
 * the screen's edge; the caller rounds it where it sits in a card.
 */
export function FlatLay({ look, className = '' }: { look: Look; className?: string }) {
  const [first, second, third, ...rest] = look.pieces
  if (!first) return <div className={`swatch aspect-[4/5] ${className}`} style={{ '--swatch': 'var(--surface)' } as CSSProperties} />
  return (
    <div className={`grid grid-cols-6 gap-px ${className}`} aria-label={`The pieces of ${look.title}`} role="group">
      <PieceImage piece={first} label={GARMENT_LABELS[first.garment_type]} sizes="(min-width: 640px) 18rem, 66vw" className={`${second ? 'col-span-4 row-span-2' : 'col-span-6'} aspect-[3/4]`} />
      {second ? <PieceImage piece={second} label={GARMENT_LABELS[second.garment_type]} sizes="(min-width: 640px) 9rem, 33vw" className={`col-span-2 ${third ? '' : 'row-span-2'} h-full`} /> : null}
      {third ? <PieceImage piece={third} label={GARMENT_LABELS[third.garment_type]} sizes="(min-width: 640px) 9rem, 33vw" className="col-span-2 h-full" /> : null}
      {rest.length > 0 ? (
        <div className="col-span-6 grid gap-px" style={{ gridTemplateColumns: `repeat(${rest.length}, minmax(0, 1fr))` }}>
          {rest.map((piece) => (
            <PieceImage key={piece.id} piece={piece} label={GARMENT_LABELS[piece.garment_type]} sizes="(min-width: 640px) 9rem, 33vw" className="h-28 sm:h-32" />
          ))}
        </div>
      ) : null}
    </div>
  )
}
