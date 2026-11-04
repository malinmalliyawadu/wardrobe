'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { seeItOnMe } from '@/app/try-on-actions'
import { Spinner } from '@/components/form'
import type { FindCard as Find } from '@/lib/feed'
import type { OnMe } from '@/lib/try-on'

import { PriceLine, ProductPhoto } from './product'

/*
 * "See it on me" on a find. A tap records the request and the image is made
 * on the server, which takes about a minute; the card asks for the status
 * every few seconds meanwhile, and keeps asking if he leaves and comes back.
 * Once ready, the button carries a small crop of the image and opens the
 * viewer: him in it, beside the shop's own photo, so the colour can be judged
 * against what is sold.
 */

const POLL_MS = 3000

type Local = OnMe | { status: 'refused'; error: string }

/** The status route sends dates as strings. */
function revive(raw: OnMe): OnMe {
  return { ...raw, started_at: new Date(raw.started_at), photo_taken: new Date(raw.photo_taken) }
}

function usd(value: number | null): string | null {
  return value === null ? null : `US$${value.toFixed(2)}`
}

export function SeeItOnMe({ find }: { find: Find }) {
  const [state, setState] = useState<Local | null>(find.on_me)
  const [starting, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const making = starting || state?.status === 'making'

  // Ask until it is made. A failed fetch just waits for the next tick.
  const makingId = state?.status === 'making' ? state.id : null
  useEffect(() => {
    if (makingId === null) return
    let stopped = false
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/photos/try-ons/${makingId}/status`, { cache: 'no-store' })
        if (!response.ok || stopped) return
        const next = revive((await response.json()) as OnMe)
        if (next.status !== 'making' && !stopped) setState(next)
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [makingId])

  function start() {
    setOpen(false)
    startTransition(async () => {
      const result = await seeItOnMe(find.product_id)
      if (!result.ok) {
        setState({ status: 'refused', error: result.message })
        return
      }
      setState({
        id: result.id,
        status: 'making',
        error: null,
        width: null,
        height: null,
        usd: null,
        started_at: new Date(),
        photo_taken: new Date(),
      })
    })
  }

  const ready = state?.status === 'ready' ? state : null

  return (
    <div className="-ml-2">
      {making ? (
        <div aria-live="polite" className="px-2 py-1.5">
          <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-ink-2">
            <Spinner />
            Putting it on you
          </p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-3">About a minute. It carries on if you leave.</p>
        </div>
      ) : ready ? (
        <button type="button" className="text-button text-ink" onClick={() => setOpen(true)} aria-haspopup="dialog">
          {/* The whole picture, small, in its own proportion: a crop of a full-length photo is mostly background. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it */}
          <img src={`/photos/try-ons/${ready.id}`} alt="" className="h-8 w-6 rounded-[0.3rem] bg-surface object-cover" />
          See it on me
        </button>
      ) : (
        <div aria-live="polite">
          <button type="button" className="text-button text-ink" onClick={start}>
            {state ? 'Try it on again' : 'See it on me'}
          </button>
          {state?.error ? <p className="px-2 text-[0.8125rem] leading-snug text-alert">{state.error}</p> : null}
        </div>
      )}
      {ready ? (
        <TryOnViewer
          find={find}
          onMe={ready}
          open={open}
          onClose={() => setOpen(false)}
          onAgain={start}
        />
      ) : null}
    </div>
  )
}

function TryOnViewer({
  find,
  onMe,
  open,
  onClose,
  onAgain,
}: {
  find: Find
  onMe: OnMe
  open: boolean
  onClose: () => void
  onAgain: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const made = onMe.started_at.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', timeZone: 'Pacific/Auckland' })
  const cost = usd(onMe.usd)
  const titleId = `try-on-${onMe.id}`

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself.
        if (event.target === event.currentTarget) onClose()
      }}
      className="viewer m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-ground p-0 text-ink lg:m-auto lg:h-auto lg:max-h-[92dvh] lg:w-[min(64rem,calc(100vw-4rem))] lg:rounded-2xl"
    >
      <div className="flex min-h-full flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:p-8">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.8125rem] text-ink-3">{find.retailer}</p>
            <h2 id={titleId} className="mt-0.5 font-display text-[1.375rem] leading-tight tracking-[-0.005em] lg:text-[1.625rem]">
              {find.title}
            </h2>
          </div>
          <button type="button" className="text-button -mr-2 shrink-0" onClick={onClose} autoFocus>
            Close
          </button>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
          <figure className="min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it */}
            <img
              src={`/photos/try-ons/${onMe.id}`}
              alt={`You wearing the ${find.title}`}
              width={onMe.width ?? undefined}
              height={onMe.height ?? undefined}
              className="mx-auto h-auto w-full rounded-xl bg-surface lg:max-h-[calc(92dvh-12rem)] lg:w-auto"
            />
            <figcaption className="mt-2 text-[0.8125rem] text-ink-3">On you, made {made}</figcaption>
          </figure>

          <div className="min-w-0">
            <figure>
              <ProductPhoto
                find={find}
                sizes="(min-width: 1024px) 24rem, 50vw"
                className="aspect-[4/5] w-1/2 rounded-xl lg:w-full"
              />
              <figcaption className="mt-2 text-[0.8125rem] text-ink-3">The shop’s photo</figcaption>
            </figure>
            <div className="mt-4">
              <PriceLine find={find} />
            </div>
            <p className="mt-3 max-w-[40ch] text-[0.875rem] leading-snug text-ink-2">
              Made by OpenAI from your full-length photo. Judge the colour against the shop’s photo, and the cut by
              the size guide: the picture cannot know how this size sits on you.
            </p>
            <div className="-ml-2 mt-4 flex flex-wrap items-center gap-1">
              <a href={find.url} target="_blank" rel="noopener noreferrer" className="text-button">
                Open the shop
              </a>
              <button type="button" className="text-button text-ink-2" onClick={onAgain}>
                Make it again
              </button>
            </div>
            {cost ? <p className="mt-2 text-[0.8125rem] text-ink-3">This one cost {cost}.</p> : null}
          </div>
        </div>
      </div>
    </dialog>
  )
}
