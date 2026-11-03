'use client'

import { useActionState, useRef, useState, type PointerEvent } from 'react'
import { useFormStatus } from 'react-dom'

import { FormMessage, Spinner, SubmitButton } from '@/components/form'
import type { Photo, PhotoKind } from '@/lib/photos'

import { deleteAllPhotos, deletePhoto, runAnalysis, uploadPhoto } from '../actions'

export function PhotoSection({
  kind,
  title,
  hint,
  photos,
  max,
}: {
  kind: PhotoKind
  title: string
  hint: string
  photos: Photo[]
  max: number
}) {
  const [state, action] = useActionState(uploadPhoto, null)

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-ink-2">{title}</h2>
      <p className="mt-1 text-sm text-ink-3">{hint}</p>
      <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {photos.map((photo) => (
          <li key={photo.id} className="tile-enter relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/photos/${photo.id}?v=thumb`}
              alt={`${title} photo`}
              width={photo.width ?? 480}
              height={photo.height ?? 640}
              className="aspect-[3/4] w-full rounded-xl border border-line object-cover"
            />
            <form action={deletePhoto} className="absolute top-1.5 right-1.5">
              <input type="hidden" name="id" value={photo.id} />
              <RemoveButton />
            </form>
          </li>
        ))}
        {photos.length < max ? (
          <li>
            <form action={action}>
              <input type="hidden" name="kind" value={kind} />
              <AddTile />
            </form>
          </li>
        ) : null}
      </ul>
      {state?.message ? (
        <div className="mt-3">
          <FormMessage message={state.message} />
        </div>
      ) : null}
    </section>
  )
}

/**
 * A file input dressed as a tile. Choosing a file submits at once; while the
 * upload runs the tile shows it, so there is never a silent wait.
 */
function AddTile() {
  const { pending } = useFormStatus()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <label
      className={`pressable flex aspect-[3/4] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm text-ink-2 ${pending ? 'cursor-progress' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        disabled={pending}
        onChange={(event) => {
          if (event.target.files?.length) event.target.form?.requestSubmit()
        }}
      />
      {pending ? (
        <>
          <Spinner />
          <span>Adding</span>
        </>
      ) : (
        <>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Add</span>
        </>
      )}
    </label>
  )
}

function RemoveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Remove photo"
      className="pressable flex size-8 items-center justify-center rounded-full bg-ground/85 text-ink backdrop-blur-sm disabled:opacity-50"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  )
}

export function AnalyseButton({ hasFace, again }: { hasFace: boolean; again: boolean }) {
  const [state, action] = useActionState(runAnalysis, null)
  return (
    <form action={action}>
      <fieldset disabled={!hasFace} className="disabled:opacity-50">
        <SubmitButton pending="Reading your photos">
          {again ? 'Read again' : 'Read my colouring'}
        </SubmitButton>
      </fieldset>
      {state?.message ? (
        <div className="mt-4">
          <FormMessage message={state.message} />
        </div>
      ) : null}
    </form>
  )
}

const HOLD_MS = 1200

/**
 * Hold to confirm. Destructive and rare, so the press is slow and the fill is
 * a real progress bar; release before the end and it snaps back. Keyboard
 * users get a confirm dialog instead of a timed press.
 */
export function DeleteAllButton({ count }: { count: number }) {
  const formRef = useRef<HTMLFormElement>(null)
  const timer = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const [done, setDone] = useState(false)

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (done || timer.current !== null) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A synthetic or already-released pointer; the hold still works, it just
      // cancels if the pointer leaves the button.
    }
    setHolding(true)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setDone(true)
      formRef.current?.requestSubmit()
    }, HOLD_MS)
  }

  function cancel() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    setHolding(false)
  }

  const label = count === 1 ? 'Delete the photo' : `Delete all ${count} photos`

  return (
    <form ref={formRef} action={deleteAllPhotos}>
      <button
        type="button"
        data-holding={holding}
        style={{ '--hold-ms': `${HOLD_MS}ms` } as React.CSSProperties}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !done) {
            event.preventDefault()
            if (window.confirm(`${label}?`)) {
              setDone(true)
              formRef.current?.requestSubmit()
            }
          }
        }}
        aria-busy={done || undefined}
        className="hold pressable inline-flex h-12 items-center justify-center rounded-full border border-line px-6 text-base font-medium text-ink select-none"
      >
        <span className="hold-fill" aria-hidden />
        <span className={`transition-colors duration-150 ${holding || done ? 'text-on-brass' : ''}`}>
          {done ? 'Deleting' : label}
        </span>
      </button>
    </form>
  )
}
