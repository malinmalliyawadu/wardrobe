'use client'

import { useActionState, useRef } from 'react'
import { useFormStatus } from 'react-dom'

import { FormMessage, Spinner, SubmitButton } from '@/components/form'
import { HoldButton } from '@/components/hold-button'
import { CrossIcon, PlusIcon } from '@/components/icons'
import { SectionHead } from '@/components/section'
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
    <section className="mt-12 first-of-type:mt-10">
      <SectionHead title={title} aside={`${photos.length} of ${max}`} />
      <p className="text-sm text-ink-3">{hint}</p>
      <ul className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-5">
        {photos.map((photo) => (
          <li key={photo.id} className="tile-enter relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/photos/${photo.id}?v=thumb`}
              alt={`${title} photo`}
              width={photo.width ?? 480}
              height={photo.height ?? 640}
              className="aspect-[3/4] w-full rounded-[var(--radius-tile)] object-cover"
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
      className={`pressable flex aspect-[3/4] w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-tile)] border border-dashed border-line text-sm font-medium text-ink-2 ${pending ? 'cursor-progress' : ''}`}
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
          <PlusIcon />
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
      <CrossIcon width={16} height={16} />
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

/** Hold to delete every photo. The read Malin confirmed is kept. */
export function DeleteAllButton({ count }: { count: number }) {
  const label = count === 1 ? 'Delete the photo' : `Delete all ${count} photos`
  return <HoldButton action={deleteAllPhotos} label={label} pendingLabel="Deleting" />
}
