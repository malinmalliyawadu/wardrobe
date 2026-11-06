'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { Field, FormMessage, PendingNote, Spinner, SubmitButton, TextInput, withEcho } from '@/components/form'
import { PhotoChoice } from '@/components/photo-choice'
import { PieceImage } from '@/components/piece-image'
import { SectionHead } from '@/components/section'
import type { OpenSlot, PieceDraft } from '@/lib/pieces'

import { draftFromLink, draftFromPhoto } from './actions'
import { PieceForm } from './piece-form'
import { formValues, type Swatch } from './piece-values'

type Mode = 'photo' | 'link' | 'typed'

const MODES: { value: Mode; label: string }[] = [
  { value: 'photo', label: 'Photo' },
  { value: 'link', label: 'Shop link' },
  { value: 'typed', label: 'Type it in' },
]

const TYPED: PieceDraft = { source: 'typed', photo_id: null, product_id: null, values: {}, preview: null, note: null }

/**
 * Three ways in, one form out. A photo is read (colour here, the rest by
 * Claude) and a link by the shop, and either fills the form he then checks
 * and saves; typing starts it blank.
 */
export function AddPiece({ best, neutrals, slots }: { best: Swatch[]; neutrals: Swatch[]; slots: OpenSlot[] }) {
  const [mode, setMode] = useState<Mode>('photo')
  const [photoState, photoAction] = useActionState(draftFromPhoto, null)
  const [linkState, linkAction] = useActionState(draftFromLink, null)
  const draft = mode === 'photo' ? photoState?.draft : mode === 'link' ? linkState?.draft : TYPED

  return (
    <>
      <div role="group" aria-label="How to add it" className="mt-6 flex flex-wrap gap-2">
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={mode === item.value}
            onClick={() => setMode(item.value)}
            className="segment pressable"
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === 'photo' ? (
        <div className="mt-6">
          <form action={photoAction}>
            <PhotoTile draft={draft ?? null} />
            <p className="mt-3 max-w-[44ch] text-[0.9375rem] leading-normal text-ink-2">
              Lay it flat or hang it up, in daylight if you can. Claude reads the photo once to fill in the form, and
              you check it.
            </p>
            <div className="mt-2">
              <PendingNote>Claude is reading the photo. About ten seconds.</PendingNote>
            </div>
          </form>
          {/* On a phone the tile opens the camera; this is the way to the photo library. */}
          <form action={photoAction} className="-mt-1 hidden pointer-coarse:block">
            <LibraryButton />
          </form>
          {photoState?.message ? (
            <div className="mt-3">
              <FormMessage message={photoState.message} />
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === 'link' ? <LinkStep state={linkState} action={linkAction} draft={draft ?? null} /> : null}

      {draft ? (
        <section aria-labelledby="piece-form" className="mt-12">
          <SectionHead id="piece-form" title={draft.source === 'typed' ? 'The piece' : 'Check what was read'} />
          {draft.note ? <p className="mt-2 max-w-[44ch] text-sm text-ink-2">{draft.note}</p> : null}
          <PieceForm
            key={`${draft.source}-${draft.photo_id ?? ''}-${draft.product_id ?? ''}`}
            origin={{ source: draft.source, photo_id: draft.photo_id, product_id: draft.product_id }}
            initial={formValues(draft.values)}
            best={best}
            neutrals={neutrals}
            slots={slots}
            submitLabel="Add to your wardrobe"
            another
          />
        </section>
      ) : null}
    </>
  )
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'

/**
 * The photo as a tile: on a phone a tap opens the back camera, on a laptop
 * the file picker, and the photo is read as soon as it is taken. Once read,
 * the tile shows it, and a tap takes another.
 */
function PhotoTile({ draft }: { draft: PieceDraft | null }) {
  const { pending } = useFormStatus()
  const photo = draft?.preview && 'photo' in draft.preview ? draft.preview.photo : null
  return (
    <label
      className={`pressable relative flex aspect-[3/4] w-44 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-tile)] border border-dashed border-line text-sm text-ink-2 ${pending ? 'cursor-progress' : ''}`}
    >
      <input
        type="file"
        name="file"
        accept={ACCEPT}
        capture="environment"
        className="sr-only"
        disabled={pending}
        onChange={(event) => {
          if (event.target.files?.length) event.target.form?.requestSubmit()
        }}
      />
      {photo && !pending ? (
        <>
          <PieceImage piece={{ name: 'Your photo', colour_hex: null, photo, image: null }} sizes="11rem" className="absolute inset-0" />
          <span className="absolute inset-x-2 bottom-2 rounded-[var(--radius-control)] bg-ground/85 px-3 py-1.5 text-center text-[0.8125rem] font-medium text-ink backdrop-blur-sm">
            <span className="pointer-coarse:hidden">Use another</span>
            <span className="hidden pointer-coarse:inline">Take another</span>
          </span>
        </>
      ) : pending ? (
        <>
          <Spinner />
          <span>Reading</span>
        </>
      ) : (
        <>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
            <circle cx="12" cy="12.8" r="3.4" />
          </svg>
          <span className="pointer-coarse:hidden">Choose a photo</span>
          <span className="hidden pointer-coarse:inline">Take a photo</span>
        </>
      )}
    </label>
  )
}

function LibraryButton() {
  const { pending } = useFormStatus()
  return (
    <>
      <label className={`text-button -ml-2 cursor-pointer text-ink-2 ${pending ? 'cursor-progress' : ''}`}>
        <input
          type="file"
          name="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            if (event.target.files?.length) event.target.form?.requestSubmit()
          }}
        />
        {pending ? (
          <>
            <Spinner />
            Reading
          </>
        ) : (
          'Or choose one from your photos'
        )}
      </label>
      <PendingNote>Claude is reading the photo. About ten seconds.</PendingNote>
    </>
  )
}

function LinkStep({
  state,
  action,
  draft,
}: {
  state: Awaited<ReturnType<typeof draftFromLink>>
  action: (form: FormData) => void
  draft: PieceDraft | null
}) {
  const v = withEcho({ link: '' }, state?.values)
  const image = draft?.preview && 'image' in draft.preview ? draft.preview : null
  return (
    <div className="mt-6">
      <form action={action} className="max-w-2xl space-y-4" key={state?.values ? JSON.stringify(state.values) : 'blank'}>
        <Field
          label="Product link"
          name="link"
          error={state?.errors?.link}
          hint="Bought it from one of the shops, or from Uniqlo? Paste the product page and its photo and details come with it."
        >
          <TextInput name="link" defaultValue={v.link} error={state?.errors?.link} placeholder="https://" />
        </Field>
        <SubmitButton pending="Reading the shop" variant={draft ? 'quiet' : 'primary'}>
          Read the link
        </SubmitButton>
      </form>
      {image && draft?.product_id ? (
        <div className="mt-6">
          <p className="max-w-[52ch] text-[0.9375rem] leading-snug text-ink-2">
            <span className="font-medium text-ink">{image.title}</span>. Choose the photo the piece shows, or add your
            own.
          </p>
          <div className="mt-3">
            <PhotoChoice
              key={draft.product_id}
              productId={draft.product_id}
              photos={image.photos}
              shown={image.image.src}
              label="The photo the piece shows"
              bleed
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
