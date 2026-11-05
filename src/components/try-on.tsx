'use client'

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react'

import { Spinner } from '@/components/form'
import type { OnMe, Started } from '@/lib/try-on'

/*
 * "See it on me", for a find and for a look alike. A tap records the request
 * and the image is made on the server, which takes about a minute; the card
 * asks for the status every few seconds meanwhile, and keeps asking if he
 * leaves and comes back. Once ready, the button carries the whole image as a
 * preview and opens the viewer: him in it, beside what it was made from, so the
 * colour can be judged against the clothes themselves.
 *
 * `initial` is the picture of the same outfit already kept, whichever look,
 * find or choice it was made for, so a card never offers to make one that is
 * there. "Make it again" in the viewer is the one way to ask for another.
 */

const POLL_MS = 3000

type Local = OnMe | { status: 'refused'; error: string }

/** The status route sends dates as strings. */
function revive(raw: OnMe): OnMe {
  return { ...raw, started_at: new Date(raw.started_at), photo_taken: new Date(raw.photo_taken) }
}

function madeOn(onMe: OnMe, month: 'long' | 'short' = 'long'): string {
  return onMe.started_at.toLocaleDateString('en-NZ', { day: 'numeric', month, timeZone: 'Pacific/Auckland' })
}

function usd(value: number | null): string | null {
  return value === null ? null : `US$${value.toFixed(2)}`
}

export type TryOnViewerContent = {
  /** Small line over the title: the shop, or the look's occasion. */
  eyebrow: string
  title: string
  /** The image's alt text: "You wearing the Ink Overshirt". */
  alt: string
  /** What it was made from, beside the image: the shop's photo, or the look's pieces. */
  aside: ReactNode
  /** How to read the image, under the aside. */
  note: ReactNode
  /** Links before "Make it again", such as the shop's page. */
  actions?: ReactNode
}

export function TryOn({
  initial,
  start: request,
  content,
  label = 'See it on me',
}: {
  initial: OnMe | null
  /** What the tap is called, before and once it is made: "See it on me". */
  label?: string
  /** `again` asks for a new picture even when one of the same outfit is kept. */
  start: (again: boolean) => Promise<Started>
  content: TryOnViewerContent
}) {
  const [state, setState] = useState<Local | null>(initial)
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

  function start(again: boolean) {
    setOpen(false)
    startTransition(async () => {
      const result = await request(again)
      if (!result.ok) {
        setState({ status: 'refused', error: result.message })
        return
      }
      // A kept picture of the same outfit: ask for its state once, and show it as it is.
      if (result.reused) {
        try {
          const response = await fetch(`/photos/try-ons/${result.id}/status`, { cache: 'no-store' })
          if (response.ok) {
            setState(revive((await response.json()) as OnMe))
            return
          }
        } catch {
          // Offline for a moment; fall through and let the polling find it.
        }
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
        <button
          type="button"
          className="pressable ml-2 flex items-center gap-3 py-1.5 text-left"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          {/* The whole picture in its own proportion, as wide as the saved row's shop photo, so he can see himself in it before opening. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it */}
          <img
            src={`/photos/try-ons/${ready.id}`}
            alt=""
            width={ready.width ?? 3}
            height={ready.height ?? 4}
            style={{ aspectRatio: `${ready.width ?? 3} / ${ready.height ?? 4}` }}
            className="h-auto w-16 shrink-0 rounded-[var(--radius-tile)] bg-surface object-cover"
          />
          <span className="min-w-0">
            <span className="block text-[0.9375rem] font-medium text-accent">{label}</span>
            <span className="mt-0.5 block text-[0.8125rem] text-ink-3">Made {madeOn(ready, 'short')}</span>
          </span>
        </button>
      ) : (
        <div aria-live="polite">
          <button type="button" className="text-button text-ink" onClick={() => start(false)}>
            {state ? 'Try it on again' : label}
          </button>
          {state?.error ? <p className="px-2 text-[0.8125rem] leading-snug text-alert">{state.error}</p> : null}
        </div>
      )}
      {ready ? <Viewer onMe={ready} content={content} open={open} onClose={() => setOpen(false)} onAgain={() => start(true)} /> : null}
    </div>
  )
}

function Viewer({
  onMe,
  content,
  open,
  onClose,
  onAgain,
}: {
  onMe: OnMe
  content: TryOnViewerContent
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

  const cost = usd(onMe.usd)
  const titleId = `try-on-${onMe.id}`
  const width = onMe.width ?? 3
  const height = onMe.height ?? 4

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself.
        if (event.target === event.currentTarget) onClose()
      }}
      className="viewer m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-ground p-0 text-ink lg:m-auto lg:h-auto lg:max-h-[92dvh] lg:w-[min(64rem,calc(100vw-4rem))] lg:rounded-[var(--radius-control)]"
    >
      <div className="flex min-h-full flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:p-8">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="caption">{content.eyebrow}</p>
            <h2 id={titleId} className="headline mt-1 text-[1.5rem] lg:text-[1.75rem]">
              {content.title}
            </h2>
          </div>
          <button type="button" className="text-button -mr-2 shrink-0" onClick={onClose} autoFocus>
            Close
          </button>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
          <figure className="min-w-0">
            {/*
             * Sized from the row, never from the file: an auto width waits on the
             * decoded picture, and Safari sometimes settled it at a thumbnail's
             * size. On the laptop it is as wide as the column allows while its
             * height still fits the sheet.
             */}
            {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it */}
            <img
              src={`/photos/try-ons/${onMe.id}`}
              alt={content.alt}
              width={width}
              height={height}
              style={{ aspectRatio: `${width} / ${height}`, '--try-on-ratio': width / height } as CSSProperties}
              className="mx-auto h-auto w-full rounded-[var(--radius-tile)] bg-surface lg:w-[min(100%,calc((92dvh-12rem)*var(--try-on-ratio)))]"
            />
            <figcaption className="caption mt-2">On you, made {madeOn(onMe)}</figcaption>
          </figure>

          <div className="min-w-0">
            {content.aside}
            <p className="mt-3 max-w-[40ch] text-[0.875rem] leading-snug text-ink-2">{content.note}</p>
            <div className="-ml-2 mt-4 flex flex-wrap items-center gap-1">
              {content.actions}
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
