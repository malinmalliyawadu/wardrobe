'use client'

import { startTransition, useActionState, useState } from 'react'

import { addLinkToSaved, chooseFindPhoto, type FindPhotoState } from '@/app/feed-actions'
import { Spinner, SubmitButton } from '@/components/form'
import { PhotoChoice } from '@/components/photo-choice'
import type { FindPhoto } from '@/lib/find-photos'
import type { ProductPhotos } from '@/lib/product-photos'
import { GARMENT_GROUPS, GARMENT_LABELS, type GarmentType } from '@/lib/wardrobe-values'

/**
 * Paste a product link from any of the shops and it joins the wishlist, found or not.
 * The shop is read there and then, so the button says so while it waits.
 * Once it is in, the shop's photos come up under the form to choose the one
 * it shows, or to add his own, until he is done or adds the next. A link from
 * a shop that cannot be read (Lululemon) opens the fields to add it by hand
 * as soon as it is pasted: its photo, what it is, the price, and the colour
 * and size he wants.
 */

export type ManualStore = { name: string; currency: string; hosts: string[] }
type Slot = { id: number; name: string; garment_type: GarmentType }

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'

function storeFor(link: string, stores: ManualStore[]): ManualStore | null {
  let host: string
  try {
    host = new URL(link.trim()).host.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  return stores.find((store) => store.hosts.includes(host)) ?? null
}

export function AddLink({ slots, manualStores }: { slots: Slot[]; manualStores: ManualStore[] }) {
  const [state, action] = useActionState(addLinkToSaved, null)
  const [photoState, photoAction, photoPending] = useActionState(chooseFindPhoto, null)
  const values = state?.ok ? undefined : state?.values
  const errors = state?.errors ?? {}

  const [link, setLink] = useState(values?.link ?? '')
  const [slotId, setSlotId] = useState(values?.slot_id ?? '')
  const [kind, setKind] = useState<string | null>(values?.garment_type ?? null)
  const [photo, setPhoto] = useState<FindPhoto | null>(null)
  const [round, setRound] = useState(0)
  const [added, setAdded] = useState<ProductPhotos | null>(null)

  // Each answer from the server, once: a new photo replaces the last, and an add clears the form for the next.
  const [seenPhoto, setSeenPhoto] = useState<FindPhotoState>(photoState)
  if (photoState !== seenPhoto) {
    setSeenPhoto(photoState)
    if (photoState?.photo) setPhoto(photoState.photo)
  }
  const [seenAdd, setSeenAdd] = useState(state)
  if (state !== seenAdd) {
    setSeenAdd(state)
    if (state?.ok) {
      setLink('')
      setSlotId('')
      setKind(null)
      setPhoto(null)
      setRound(round + 1)
      setAdded(state.added ?? null)
    }
  }

  const store = storeFor(link, manualStores)
  const slotKind = slots.find((slot) => String(slot.id) === slotId)?.garment_type ?? ''
  const linkError = errors.link

  return (
    <>
      <form key={round} action={action} className="mt-6">
        <label htmlFor="saved-link" className="mb-1.5 block text-sm font-medium text-ink-2">
          Add a product you want
        </label>
        <input
          id="saved-link"
          name="link"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={store ? 'next' : 'go'}
          placeholder="Paste a link from one of the shops"
          defaultValue={values?.link ?? ''}
          onChange={(event) => setLink(event.target.value)}
          aria-invalid={linkError ? true : undefined}
          aria-describedby={linkError ? 'saved-link-error' : undefined}
          className="field"
        />
        {linkError ? (
          <p id="saved-link-error" role="alert" className="mt-1.5 text-sm text-alert">
            {linkError}
          </p>
        ) : null}

        {store ? (
          <ByHand
            store={store}
            values={values}
            errors={errors}
            photo={photo}
            photoPending={photoPending}
            photoMessage={photoState?.ok === false ? photoState.message : undefined}
            kind={kind ?? slotKind}
            onKind={setKind}
            onPhoto={(file) => {
              const form = new FormData()
              form.set('file', file)
              startTransition(() => photoAction(form))
            }}
          />
        ) : null}

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor="saved-slot" className="sr-only">
            For which slot
          </label>
          <select
            id="saved-slot"
            name="slot_id"
            value={slotId}
            onChange={(event) => setSlotId(event.target.value)}
            className="field sm:flex-1"
          >
            <option value="">Not for a slot</option>
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                For: {slot.name}
              </option>
            ))}
          </select>
          <SubmitButton pending={store ? 'Saving' : 'Reading the shop'} variant="quiet" className="sm:shrink-0">
            Add to wishlist
          </SubmitButton>
        </div>
      </form>
      {added ? (
        <div key={added.product_id} className="tray mt-6" aria-live="polite">
          <p className="max-w-[52ch] text-[0.9375rem] leading-snug text-ink-2">
            <span className="font-medium text-ink">{added.title}</span> is on your wishlist. Choose the photo it shows,
            here and in a try-on, or add your own.
          </p>
          <div className="mt-3">
            <PhotoChoice productId={added.product_id} photos={added.photos} shown={added.shown} bleed />
          </div>
          <button type="button" className="text-button -ml-2 mt-1" onClick={() => setAdded(null)}>
            Done
          </button>
        </div>
      ) : null}
    </>
  )
}

/**
 * The fields for a find from a shop that cannot be read. The photo is stored
 * the moment it is chosen and the form carries only its id, so a mistake in
 * another field never costs the photo.
 */
function ByHand({
  store,
  values,
  errors,
  photo,
  photoPending,
  photoMessage,
  kind,
  onKind,
  onPhoto,
}: {
  store: ManualStore
  values: Record<string, string> | undefined
  errors: Record<string, string>
  photo: FindPhoto | null
  photoPending: boolean
  photoMessage: string | undefined
  kind: string
  onKind: (value: string) => void
  onPhoto: (file: File) => void
}) {
  const photoError = photoMessage ?? (photo ? undefined : errors.photo_id)
  return (
    <div className="mt-4 border-l-2 border-line pl-4">
      <p className="max-w-[44ch] text-[0.9375rem] leading-relaxed text-ink-2">
        {store.name}’s site cannot be read automatically, so add this one by hand. Its price is what you enter here,
        and it is not checked each night.
      </p>

      <div className="mt-4 flex items-start gap-4">
        <label
          className={`photo pressable relative flex aspect-[4/5] w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-tile)] text-center text-[0.8125rem] text-ink-2 ${photo && !photoPending ? '' : 'border border-dashed border-line'} ${photoPending ? 'cursor-progress' : ''}`}
        >
          {/* No name: the photo goes up on its own, and the form carries its id. */}
          <input
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={photoPending}
            aria-label={photo ? 'Choose another photo' : 'Choose its photo'}
            aria-invalid={photoError ? true : undefined}
            aria-describedby={photoError ? 'saved-photo-error' : 'saved-photo-hint'}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onPhoto(file)
              event.target.value = ''
            }}
          />
          {photoPending ? (
            <>
              <Spinner />
              <span>Adding</span>
            </>
          ) : photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/photos/finds/${photo.id}?w=384`}
              alt="Its photo"
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
              <span className="px-2 leading-tight">Its photo</span>
            </>
          )}
        </label>
        <div className="min-w-0 pt-1">
          <p id="saved-photo-hint" className="text-[0.875rem] leading-snug text-ink-3">
            {photo
              ? 'Tap the photo to use another.'
              : 'On the shop’s page, hold its photo and save it to your photos, then choose it here.'}
          </p>
          {photoError ? (
            <p id="saved-photo-error" role="alert" className="mt-1.5 text-sm text-alert">
              {photoError}
            </p>
          ) : null}
        </div>
      </div>
      <input type="hidden" name="photo_id" value={photo?.id ?? ''} />

      <div className="mt-4 space-y-4">
        <Text id="name" label="What it is called" defaultValue={values?.name} error={errors.name} placeholder="License to Train jogger" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="saved-garment_type" className="mb-1.5 block text-sm font-medium text-ink-2">
              What it is
            </label>
            <select
              id="saved-garment_type"
              name="garment_type"
              value={kind}
              onChange={(event) => onKind(event.target.value)}
              aria-invalid={errors.garment_type ? true : undefined}
              aria-describedby={errors.garment_type ? 'saved-garment_type-error' : undefined}
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
              <p id="saved-garment_type-error" role="alert" className="mt-1.5 text-sm text-alert">
                {errors.garment_type}
              </p>
            ) : null}
          </div>
          <Text id="price" label="Price" unit={store.currency} defaultValue={values?.price} error={errors.price} decimal />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Text id="colour" label="Colour" defaultValue={values?.colour} error={errors.colour} placeholder="Optional" />
          <Text id="size" label="Your size" defaultValue={values?.size} error={errors.size} placeholder="Optional" />
        </div>
      </div>
    </div>
  )
}

/** A labelled text field with its own error. Ids carry "saved-", as other pages stay in the DOM hidden. */
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
  defaultValue: string | undefined
  error: string | undefined
  placeholder?: string
  unit?: string
  decimal?: boolean
}) {
  const field = `saved-${id}`
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
          defaultValue={defaultValue ?? ''}
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
