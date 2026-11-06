'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { feedAction } from '@/app/feed-actions'
import { PhotoChoice } from '@/components/photo-choice'
import { PieceImage } from '@/components/piece-image'
import type { FindCard as Find, SavedFind, DismissReason } from '@/lib/feed'
import type { WornWith } from '@/lib/statements'
import type { OnMe } from '@/lib/try-on'

import { PriceLine, sizeLine } from './product'
import { ProductPhoto } from './product-photo'
import type { ChangeLine } from './saved-change'
import { SeeItOnMe, SeeOutfitOnMe } from './try-on'

/*
 * One find. The photo and title open the shop's page; the actions sit under
 * the why. Dismiss swaps the actions for its reasons, Bought asks once (it
 * fills the slot), and whatever the card is acted on with, it fades out at
 * once and the server's next render drops it. If the save fails, it comes back.
 */

const REASONS: { value: DismissReason; label: string }[] = [
  { value: 'colour', label: 'Colour' },
  { value: 'fit', label: 'Fit' },
  { value: 'price', label: 'Price' },
  { value: 'not_for_me', label: 'Not my thing' },
]

type Mode = 'actions' | 'dismiss' | 'bought'

function useFeedAction() {
  const [gone, setGone] = useState(false)
  const [failed, setFailed] = useState(false)
  const [, startTransition] = useTransition()
  function send(input: Parameters<typeof feedAction>[0]) {
    setGone(true)
    setFailed(false)
    startTransition(async () => {
      const result = await feedAction(input)
      if (!result.ok) {
        setGone(false)
        setFailed(true)
      }
    })
  }
  return { gone, failed, send }
}

/**
 * slotName is null for a search result or a statement piece, which fill no
 * slot. A statement piece says what makes it one (its colour, texture or cut)
 * in place of a match, shows the pieces of his it wears with under the why,
 * and can be put on him with them; in a grid it takes its cell's width rather
 * than a swipe row's.
 */
export function FindCard({
  find,
  slotName,
  statement = null,
  inGrid = false,
}: {
  find: Find
  slotName: string | null
  statement?: { qualities: string; wearsWith: WornWith[]; outfitOnMe: OnMe | null } | null
  inGrid?: boolean
}) {
  const [mode, setMode] = useState<Mode>('actions')
  const { gone, failed, send } = useFeedAction()
  const ids = { product_id: find.product_id, slot_id: find.slot_id }

  return (
    <article
      data-gone={gone}
      aria-hidden={gone || undefined}
      className={`find flex flex-col ${inGrid ? 'min-w-0' : 'w-[72vw] max-w-[20rem] sm:w-[20rem] lg:w-auto lg:max-w-none'}`}
    >
      <a href={find.url} target="_blank" rel="noopener noreferrer" className="pressable block" tabIndex={gone ? -1 : 0}>
        <ProductPhoto
          find={find}
          sizes={inGrid ? '(min-width: 1024px) 18rem, (min-width: 640px) 45vw, 92vw' : '(min-width: 1024px) 15rem, (min-width: 640px) 20rem, 72vw'}
          className="aspect-[4/5] rounded-[var(--radius-tile)]"
        />
        <p className="caption mt-3 flex items-baseline justify-between gap-3">
          <span className="truncate">{find.retailer}</span>
          {statement ? null : <span className="shrink-0 tabular-nums">Match {find.score}</span>}
        </p>
        <h3 className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium text-ink">{find.title}</h3>
      </a>
      <div className="mt-1">
        <PriceLine find={find} />
      </div>
      {statement ? <p className="mt-2 text-[0.8125rem] font-medium text-ink">{statement.qualities}</p> : null}
      {find.why ? (
        <p className={`prose line-clamp-4 text-[0.875rem] leading-snug text-ink-2 ${statement ? 'mt-1' : 'mt-2'}`}>{find.why}</p>
      ) : null}
      {statement && statement.wearsWith.length > 0 ? <WearsWith pieces={statement.wearsWith} /> : null}
      <p className="mt-2 text-[0.8125rem] text-ink-3">
        {sizeLine(find)}
        {find.colour_option ? ` in ${find.colour_option}` : ''}
      </p>
      {find.try_on ? <p className="mt-0.5 text-[0.8125rem] text-ink-3">Try on at {find.try_on}</p> : null}

      <div className="mt-auto pt-3">
        <div key={mode} className="tray">
          {mode === 'actions' ? (
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-quiet btn-small" onClick={() => send({ action: 'saved', ...ids })}>
                Save
              </button>
              <button type="button" className="text-button text-ink-2" onClick={() => setMode('bought')}>
                Bought it
              </button>
              <button type="button" className="text-button ml-auto -mr-2 text-ink-2" onClick={() => setMode('dismiss')}>
                Dismiss
              </button>
            </div>
          ) : mode === 'dismiss' ? (
            <div role="group" aria-label="Why dismiss it?">
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    type="button"
                    className="chip pressable"
                    onClick={() => send({ action: 'dismissed', ...ids, reason: reason.value })}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
              <button type="button" className="text-button -ml-2 mt-1 text-ink-3" onClick={() => setMode('actions')}>
                Keep it
              </button>
            </div>
          ) : (
            <div>
              <p className="text-[0.8125rem] leading-snug text-ink-2">
                {slotName ? `This fills your ${slotName.toLowerCase()} slot.` : 'It goes into your wardrobe as a piece.'}
              </p>
              <div className="-ml-2 mt-1 flex items-center gap-1">
                <button type="button" className="text-button" onClick={() => send({ action: 'bought', ...ids })}>
                  Yes, I bought it
                </button>
                <button type="button" className="text-button text-ink-3" onClick={() => setMode('actions')}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="mt-1">
          <SeeItOnMe find={find} />
          {statement && statement.wearsWith.length > 0 ? (
            <SeeOutfitOnMe find={find} pieces={statement.wearsWith} initial={statement.outfitOnMe} />
          ) : null}
        </div>
        {failed ? <p className="mt-1 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
      </div>
    </article>
  )
}

/** The pieces of his it wears with, small, each a tap to the piece. */
function WearsWith({ pieces }: { pieces: WornWith[] }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <p className="caption shrink-0">With your</p>
      <ul className="flex min-w-0 gap-1.5">
        {pieces.map((piece) => (
          <li key={piece.id}>
            <Link href={`/wardrobe/${piece.id}`} title={piece.name} className="pressable block rounded-[var(--radius-tile)]">
              <PieceImage piece={piece} sizes="2.5rem" className="aspect-[3/4] w-10 rounded-[var(--radius-tile)]" />
              <span className="sr-only">{piece.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A saved find: a compact row, with what changed since he saved it. */
export function SavedRow({ find, slotName, change }: { find: SavedFind; slotName: string | null; change: ChangeLine | null }) {
  const [mode, setMode] = useState<'actions' | 'bought' | 'photo'>('actions')
  const { gone, failed, send } = useFeedAction()
  const ids = { product_id: find.product_id, slot_id: find.slot_id }

  return (
    <li data-gone={gone} aria-hidden={gone || undefined} className="find flex gap-4 py-4 lg:border-b lg:border-line">
      <a href={find.url} target="_blank" rel="noopener noreferrer" className="pressable block shrink-0" tabIndex={gone ? -1 : 0}>
        <ProductPhoto find={find} sizes="5.5rem" className="aspect-[4/5] w-22 rounded-[var(--radius-tile)]" />
      </a>
      <div className="min-w-0 flex-1">
        <p className="caption truncate">{slotName ? `${find.retailer}, for your ${slotName.toLowerCase()}` : find.retailer}</p>
        <a href={find.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium">
          {find.title}
        </a>
        <div className="mt-1">
          {find.inStock ? (
            <PriceLine find={find} />
          ) : (
            // Out of stock, the change line is the whole story: when it sold out.
            <p className="text-[0.9375rem] text-ink-3">{change?.text ?? 'Not in your size right now'}</p>
          )}
        </div>
        {find.inStock && (find.colour || find.sizes.length > 0) ? (
          <p className="mt-1 text-[0.8125rem] text-ink-3">
            {[
              find.colour,
              find.yourSizeOut ? `Your ${find.yourSizeOut} is sold out` : null,
              find.sizes.length === 0 ? null : find.byHand ? `Your size ${find.sizes.join(', ')}` : sizeLine(find),
            ]
              .filter(Boolean)
              .join('. ')}
          </p>
        ) : null}
        {find.byHand ? <p className="mt-1 text-[0.8125rem] text-ink-3">Added by hand, so the price is not checked</p> : null}
        {change && find.inStock ? (
          <p className={`mt-1 text-[0.8125rem] ${change.tone === 'good' ? 'font-medium text-accent' : 'text-ink-3'}`}>{change.text}</p>
        ) : null}
        {find.try_on && find.inStock ? <p className="mt-1 text-[0.8125rem] text-ink-3">Try on at {find.try_on}</p> : null}
        <div className="mt-1">
          <SeeItOnMe find={find} />
        </div>
        <div key={mode} className="tray">
          {mode === 'actions' ? (
            <div className="-ml-2 flex flex-wrap items-center gap-x-1">
              <button type="button" className="text-button" onClick={() => setMode('bought')}>
                Bought it
              </button>
              <button type="button" className="text-button text-ink-2" onClick={() => setMode('photo')}>
                Change photo
              </button>
              <button type="button" className="text-button text-ink-2" onClick={() => send({ action: 'cleared', ...ids })}>
                Remove
              </button>
            </div>
          ) : mode === 'photo' ? (
            <div className="mt-2">
              <PhotoChoice productId={find.product_id} photos={find.photos} shown={find.image?.src ?? null} />
              <button type="button" className="text-button -ml-2 mt-1" onClick={() => setMode('actions')}>
                Done
              </button>
            </div>
          ) : (
            <div className="-ml-2 flex flex-wrap items-center gap-1">
              <button type="button" className="text-button" onClick={() => send({ action: 'bought', ...ids })}>
                {slotName ? 'Yes, it fills the slot' : 'Yes, I bought it'}
              </button>
              <button type="button" className="text-button text-ink-3" onClick={() => setMode('actions')}>
                Cancel
              </button>
            </div>
          )}
        </div>
        {failed ? <p className="text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
      </div>
    </li>
  )
}
