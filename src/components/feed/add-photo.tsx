'use client'

import { useActionState, useState } from 'react'

import { addPhotoToSaved, readPhotoWish, type WishPhotoState } from '@/app/feed-actions'
import { Spinner, SubmitButton, withEcho } from '@/components/form'
import type { ActionState } from '@/lib/action-state'
import type { FindPhoto } from '@/lib/find-photos'
import { GARMENT_GROUPS, GARMENT_LABELS, type GarmentType } from '@/lib/wardrobe-values'

/**
 * Something he saw, with no link: a screenshot, a photo in a shop. The photo
 * is stored and read by Claude the moment he chooses it, which fills in the
 * fields; he checks them and adds it. Nothing about it is checked at night,
 * since there is no page to read. Once it is in, the form starts again for
 * the next.
 */

type Slot = { id: number; name: string; garment_type: GarmentType }

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'

export function AddPhoto({ slots }: { slots: Slot[] }) {
  const [addState, addAction] = useActionState(addPhotoToSaved, null)
  const [round, setRound] = useState(0)
  const [added, setAdded] = useState<string | null>(null)

  // Each answer from the server, once: an add starts the form again and says what went in.
  const [seen, setSeen] = useState<ActionState>(addState)
  if (addState !== seen) {
    setSeen(addState)
    if (addState?.ok) {
      setRound(round + 1)
      setAdded(addState.message ?? 'It')
    }
  }

  return (
    <>
      <PhotoWish
        key={round}
        slots={slots}
        addState={addState?.ok ? null : addState}
        addAction={addAction}
        onRead={() => setAdded(null)}
      />
      {added ? (
        <p className="tray mt-4 text-[0.9375rem] text-ink-2" aria-live="polite">
          <span className="font-medium text-ink">{added}</span> is on your wishlist.
        </p>
      ) : null}
    </>
  )
}

function PhotoWish({
  slots,
  addState,
  addAction,
  onRead,
}: {
  slots: Slot[]
  addState: ActionState
  addAction: (form: FormData) => void
  onRead: () => void
}) {
  const [readState, readAction, reading] = useActionState(readPhotoWish, null)
  // The last photo that was read: a later photo that fails to go up keeps this one.
  const [read, setRead] = useState<Extract<WishPhotoState, { ok: true }> | null>(null)
  const [seen, setSeen] = useState<WishPhotoState>(readState)
  if (readState !== seen) {
    setSeen(readState)
    if (readState?.ok) setRead(readState)
  }

  const photo = read?.photo ?? null
  const errors = addState?.errors ?? {}
  const readMessage = readState?.ok === false ? readState.message : undefined
  const photoError = readMessage ?? errors.photo_id
  const v = withEcho(
    {
      name: read?.values.name ?? '',
      garment_type: read?.values.garment_type ?? '',
      price: read?.values.price ?? '',
      shop: read?.values.shop ?? '',
      slot_id: '',
    },
    addState?.values,
  )

  return (
    <div>
      <div className="flex items-start gap-4">
        <form action={readAction} className="shrink-0">
          <Tile photo={photo} reading={reading} error={photoError} onChoose={onRead} />
        </form>
        <div className="min-w-0 pt-1">
          <p id="wish-photo-hint" className="max-w-[40ch] text-[0.9375rem] leading-snug text-ink-2">
            {reading
              ? 'Claude is reading the photo. About ten seconds.'
              : photo
                ? 'Check what Claude read. Tap the photo to use another.'
                : 'A screenshot, or a photo you took in a shop. Claude reads it once to fill in what it is, and you check it.'}
          </p>
          {photoError ? (
            <p id="wish-photo-error" role="alert" className="mt-1.5 text-sm text-alert">
              {photoError}
            </p>
          ) : null}
        </div>
      </div>

      {photo && !reading ? (
        <form key={`${photo.id}:${JSON.stringify(addState?.values ?? null)}`} action={addAction} className="tray mt-5">
          {read?.note ? <p className="mb-4 max-w-[44ch] text-sm text-ink-2">{read.note}</p> : null}
          <input type="hidden" name="photo_id" value={photo.id} />
          <input type="hidden" name="colour_hex" value={read?.values.colour_hex ?? ''} />
          <div className="space-y-4">
            <Text id="name" label="What it is called" defaultValue={v.name} error={errors.name} />
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label htmlFor="wish-garment_type" className="mb-1.5 block text-sm font-medium text-ink-2">
                  What it is
                </label>
                <select
                  id="wish-garment_type"
                  name="garment_type"
                  defaultValue={v.garment_type}
                  aria-invalid={errors.garment_type ? true : undefined}
                  aria-describedby={errors.garment_type ? 'wish-garment_type-error' : undefined}
                  className="field"
                >
                  <option value="">Choose</option>
                  {GARMENT_GROUPS.map((group) => (
                    <optgroup key={group.title} label={group.title}>
                      {group.types.map((type) => (
                        <option key={type} value={type}>
                          {GARMENT_LABELS[type]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {errors.garment_type ? (
                  <p id="wish-garment_type-error" role="alert" className="mt-1.5 text-sm text-alert">
                    {errors.garment_type}
                  </p>
                ) : null}
              </div>
              <Text id="price" label="Price" unit="NZD" defaultValue={v.price} error={errors.price} placeholder="Optional" decimal />
            </div>
            <Text id="shop" label="Brand or shop" defaultValue={v.shop} error={errors.shop} placeholder="Optional" />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label htmlFor="wish-slot" className="sr-only">
              For which slot
            </label>
            <select id="wish-slot" name="slot_id" defaultValue={v.slot_id} className="field sm:flex-1">
              <option value="">Not for a slot</option>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  For: {slot.name}
                </option>
              ))}
            </select>
            <SubmitButton pending="Saving" variant="quiet" className="sm:shrink-0">
              Add to wishlist
            </SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  )
}

/** The photo as a tile: a tap opens the photo library (or the camera), and the photo is read as soon as it is chosen. */
function Tile({
  photo,
  reading,
  error,
  onChoose,
}: {
  photo: FindPhoto | null
  reading: boolean
  error: string | undefined
  onChoose: () => void
}) {
  return (
    <label
      className={`photo pressable relative flex aspect-[4/5] w-28 cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-tile)] text-center text-[0.8125rem] text-ink-2 ${photo && !reading ? '' : 'border border-dashed border-line'} ${reading ? 'cursor-progress' : ''}`}
    >
      <input
        type="file"
        name="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={reading}
        aria-label={photo ? 'Choose another photo' : 'Choose a photo'}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'wish-photo-error' : 'wish-photo-hint'}
        onChange={(event) => {
          if (!event.target.files?.length) return
          onChoose()
          event.target.form?.requestSubmit()
        }}
      />
      {reading ? (
        <>
          <Spinner />
          <span>Reading</span>
        </>
      ) : photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/photos/finds/${photo.id}?w=384`}
          alt="Your photo"
          width={photo.width}
          height={photo.height}
          className="absolute inset-0 size-full object-contain"
        />
      ) : (
        <>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <circle cx="9.5" cy="9.5" r="1.6" />
            <path d="m20 15-4.5-4.5L6 20" />
          </svg>
          <span className="px-2 leading-tight">Choose a photo</span>
        </>
      )}
    </label>
  )
}

/** A labelled text field with its own error. Ids carry "wish-", as other pages stay in the DOM hidden. */
function Text({
  id,
  label,
  defaultValue,
  error,
  placeholder,
  unit,
  decimal = false,
}: {
  id: string
  label: string
  defaultValue: string
  error: string | undefined
  placeholder?: string
  unit?: string
  decimal?: boolean
}) {
  const field = `wish-${id}`
  return (
    <div className="min-w-0">
      <label htmlFor={field} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={field}
          name={id}
          type="text"
          inputMode={decimal ? 'decimal' : undefined}
          autoComplete="off"
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${field}-error` : undefined}
          className={`field ${unit ? 'pr-14' : ''}`}
        />
        {unit ? (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-3">{unit}</span>
        ) : null}
      </div>
      {error ? (
        <p id={`${field}-error`} role="alert" className="mt-1.5 text-sm text-alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
