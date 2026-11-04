'use client'

import { useState, useTransition } from 'react'

import { feedAction } from '@/app/feed-actions'
import type { FindCard as Find, SavedFind, DismissReason } from '@/lib/feed'

import { nzd, PriceLine, ProductPhoto } from './product'
import { SeeItOnMe } from './try-on'

/*
 * One find on Today. The photo and title open the shop's page; the actions sit
 * under the why. Dismiss swaps the actions for its reasons, Bought asks once
 * (it fills the slot), and whatever the card is acted on with, it fades out at
 * once and the server's next render drops it. If the save fails, it comes back.
 */

const REASONS: { value: DismissReason; label: string }[] = [
  { value: 'colour', label: 'Colour' },
  { value: 'fit', label: 'Fit' },
  { value: 'price', label: 'Price' },
  { value: 'not_for_me', label: 'Not my thing' },
]

/** "34 inch Waist x 32 inch Leg" reads as "34/32" on a card. */
function shortSize(label: string): string {
  const waistLeg = /^(\d{2})\s*(?:"|inch(?:es)?|in)?\s*waist\s*x\s*(\d{2})\s*(?:"|inch(?:es)?|in)?\s*leg$/i.exec(label.trim())
  return waistLeg ? `${waistLeg[1]}/${waistLeg[2]}` : label
}

export function sizeLine(find: Find): string {
  if (find.sizes.length === 1 && /^one size$/i.test(find.sizes[0]!)) return 'One size'
  const sizes = [...new Set(find.sizes.map(shortSize))]
  if (find.size_known) return `Your ${sizes.join(', ')} in stock`
  const shown = sizes.slice(0, 6).join(', ')
  return `In stock: ${shown}${sizes.length > 6 ? ' and more' : ''}`
}

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

export function FindCard({ find, slotName }: { find: Find; slotName: string }) {
  const [mode, setMode] = useState<Mode>('actions')
  const { gone, failed, send } = useFeedAction()
  const ids = { product_id: find.product_id, slot_id: find.slot_id }

  return (
    <article
      data-gone={gone}
      aria-hidden={gone || undefined}
      className="find flex w-[15.5rem] shrink-0 snap-start flex-col sm:w-[16.5rem] lg:w-auto"
    >
      <a href={find.url} target="_blank" rel="noopener noreferrer" className="pressable block rounded-xl" tabIndex={gone ? -1 : 0}>
        <ProductPhoto find={find} sizes="(min-width: 1024px) 13.5rem, (min-width: 640px) 16.5rem, 15.5rem" className="aspect-[4/5] rounded-xl" />
        <p className="mt-3 flex items-baseline justify-between gap-3 text-[0.8125rem] text-ink-3">
          <span className="truncate">{find.retailer}</span>
          <span className="shrink-0 tabular-nums">Match {find.score}</span>
        </p>
        <h4 className="mt-1 line-clamp-2 text-[0.9375rem] leading-snug font-medium text-ink">{find.title}</h4>
      </a>
      <div className="mt-1.5">
        <PriceLine find={find} />
      </div>
      {find.why ? <p className="mt-2 line-clamp-4 text-[0.875rem] leading-snug text-ink-2">{find.why}</p> : null}
      <p className="mt-2 text-[0.8125rem] text-ink-3">
        {sizeLine(find)}
        {find.colour_option ? ` in ${find.colour_option}` : ''}
      </p>
      {find.try_on ? <p className="mt-1 text-[0.8125rem] text-ink-3">Try on at {find.try_on}</p> : null}

      <div className="mt-auto pt-2">
        <SeeItOnMe find={find} />
        <div key={mode} className="tray">
          {mode === 'actions' ? (
            <div className="-ml-2 flex items-center gap-1">
              <button type="button" className="text-button" onClick={() => send({ action: 'saved', ...ids })}>
                Save
              </button>
              <button type="button" className="text-button text-ink-2" onClick={() => setMode('bought')}>
                Bought it
              </button>
              <button type="button" className="text-button ml-auto text-ink-2" onClick={() => setMode('dismiss')}>
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
              <p className="text-[0.8125rem] leading-snug text-ink-2">This fills your {slotName.toLowerCase()} slot.</p>
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
        {failed ? <p className="mt-1 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
      </div>
    </article>
  )
}

/** A saved find: a compact row, with what changed since he saved it. */
export function SavedRow({ find, slotName }: { find: SavedFind; slotName: string }) {
  const [mode, setMode] = useState<'actions' | 'bought'>('actions')
  const { gone, failed, send } = useFeedAction()
  const ids = { product_id: find.product_id, slot_id: find.slot_id }
  const dropped =
    find.inStock && find.savedNzdCents !== null && find.price.nzdCents < find.savedNzdCents ? find.savedNzdCents : null

  return (
    <li data-gone={gone} aria-hidden={gone || undefined} className="find flex gap-4 py-4">
      <a href={find.url} target="_blank" rel="noopener noreferrer" className="pressable block shrink-0 rounded-lg" tabIndex={gone ? -1 : 0}>
        <ProductPhoto find={find} sizes="5rem" className="aspect-[4/5] w-20 rounded-lg" />
      </a>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8125rem] text-ink-3">
          {find.retailer}, for your {slotName.toLowerCase()}
        </p>
        <a href={find.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium">
          {find.title}
        </a>
        <div className="mt-1">
          {find.inStock ? <PriceLine find={find} /> : <p className="text-[0.9375rem] text-ink-3">Not in your size right now</p>}
        </div>
        {dropped !== null ? (
          <p className="mt-1 text-[0.8125rem] font-medium text-brass">Down from {nzd(dropped)} when you saved it</p>
        ) : null}
        <div key={mode} className="tray mt-1">
          {mode === 'actions' ? (
            <div className="-ml-2 flex items-center gap-1">
              <button type="button" className="text-button" onClick={() => setMode('bought')}>
                Bought it
              </button>
              <button type="button" className="text-button text-ink-2" onClick={() => send({ action: 'cleared', ...ids })}>
                Remove
              </button>
            </div>
          ) : (
            <div className="-ml-2 flex flex-wrap items-center gap-1">
              <button type="button" className="text-button" onClick={() => send({ action: 'bought', ...ids })}>
                Yes, it fills the slot
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
