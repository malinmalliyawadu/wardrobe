import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { SubmitButton } from '@/components/form'
import { HoldButton } from '@/components/hold-button'
import { PieceImage } from '@/components/piece-image'
import { SectionHead } from '@/components/section'
import { day } from '@/lib/format'
import { fillableSlots, getPiece, inPalette } from '@/lib/pieces'
import { colourNameFor, getGuide } from '@/lib/style-guide'
import { GARMENT_LABELS, type WornFor } from '@/lib/wardrobe-values'

import { removePiece, restore, setAsidePiece } from '../actions'
import { PieceSkeleton } from '../skeletons'
import { PhotoButton } from '../photo-button'
import { PieceForm } from '../piece-form'
import { formValues, paletteSwatches } from '../piece-values'

export const metadata: Metadata = { title: 'Piece' }

const LINK = 'text-accent underline decoration-accent/40 underline-offset-4'

export default function PiecePage({ params }: PageProps<'/wardrobe/[id]'>) {
  return (
    <section>
      <BackLink href="/wardrobe" label="Wardrobe" />
      <Suspense fallback={<PieceSkeleton />}>
        <Content params={params} />
      </Suspense>
    </section>
  )
}

async function Content({ params }: Pick<PageProps<'/wardrobe/[id]'>, 'params'>) {
  await connection()
  const { id: raw } = await params
  const id = Number(raw)
  const valid = Number.isInteger(id) && id > 0
  const [piece, guide, slots] = await Promise.all([valid ? getPiece(id) : null, getGuide(), valid ? fillableSlots(id) : []])

  if (!piece) {
    return (
      <>
        <h1 className="headline mt-3 text-[2rem] sm:text-[2.5rem]">Piece not found</h1>
        <p className="mt-4 text-ink-2">
          It may have been deleted.{' '}
          <Link href="/wardrobe" className={LINK}>
            Back to your wardrobe
          </Link>
          .
        </p>
      </>
    )
  }

  const colour = colourNameFor(guide, piece.colour_hex ?? '') ?? piece.colour_name
  const palette = guide && piece.colour_hex ? (inPalette(piece.colour_hex, guide) ? 'in your palette' : 'outside your palette') : null

  return (
    <div className="mt-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-x-12 lg:gap-y-0">
      <div className="w-56 lg:w-72">
        <PieceImage piece={piece} sizes="18rem" thumb={false} className="aspect-[3/4] rounded-[var(--radius-tile)]" />
        <div className="mt-1">
          <PhotoButton id={piece.id} hasPhoto={piece.photo !== null} />
        </div>
      </div>

      <div className="mt-6 min-w-0 max-w-2xl lg:mt-0">
        <h1 className="display text-[2rem] sm:text-[2.5rem]">{piece.name}</h1>
        <p className="mt-3 text-[0.9375rem] text-ink-2">
          {[GARMENT_LABELS[piece.garment_type], colour, palette, WORN_FOR_LINE[piece.worn_for]].filter(Boolean).join(', ')}.
        </p>
        {piece.slot_id && piece.slot_name && !piece.set_aside_at ? (
          <p className="mt-2 text-[0.9375rem] text-ink-2">
            Fills your{' '}
            <Link href={`/blueprint/${piece.slot_id}`} className={LINK}>
              {piece.slot_name.toLowerCase()}
            </Link>{' '}
            slot.
          </p>
        ) : null}
        {piece.product_url && piece.retailer ? (
          <p className="mt-2 text-[0.9375rem] text-ink-2">
            From{' '}
            <a href={piece.product_url} target="_blank" rel="noopener noreferrer" className={LINK}>
              {piece.retailer}
            </a>
            .
          </p>
        ) : null}

        {piece.set_aside_at ? (
          <div className="mt-8">
            <p className="text-[0.9375rem] text-ink-2">Set aside on {day(piece.set_aside_at)}. Looks leave it out.</p>
            <form action={restore} className="mt-3">
              <input type="hidden" name="id" value={piece.id} />
              <SubmitButton pending="Restoring" variant="quiet" size="small">
                Back in the wardrobe
              </SubmitButton>
            </form>
          </div>
        ) : null}

        <section aria-labelledby="details" className="mt-12">
          <SectionHead id="details" title="Details" />
          <PieceForm
            key={`${piece.id}-${piece.edited_at?.toISOString() ?? 'new'}-${piece.slot_id ?? ''}`}
            id={piece.id}
            initial={formValues(piece)}
            {...paletteSwatches(guide)}
            slots={slots}
            submitLabel="Save piece"
          />
        </section>

        {piece.set_aside_at ? null : (
          <section aria-labelledby="set-aside" className="mt-14">
            <SectionHead id="set-aside" title="Set it aside" />
            <p className="mt-3 max-w-[42ch] text-[0.9375rem] text-ink-2">
              Worn out, or given away. It stays on record, but looks leave it out.
            </p>
            <form action={setAsidePiece} className="mt-5 space-y-5">
              <input type="hidden" name="id" value={piece.id} />
              {piece.slot_id && piece.slot_name ? (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-ink-2">Its slot, {piece.slot_name.toLowerCase()}</legend>
                  <div className="flex flex-wrap gap-2">
                    <label className="segment pressable">
                      <input type="radio" name="slot_to" value="wanted" defaultChecked className="sr-only" />
                      Find another
                    </label>
                    <label className="segment pressable">
                      <input type="radio" name="slot_to" value="retired" className="sr-only" />
                      Retire the slot
                    </label>
                  </div>
                </fieldset>
              ) : null}
              <SubmitButton pending="Setting aside" variant="quiet">
                Set aside
              </SubmitButton>
            </form>
          </section>
        )}

        <section aria-labelledby="delete" className="mt-14">
          <SectionHead id="delete" title="Delete" />
          <div className="mt-4">
            <HoldButton
              action={removePiece}
              label="Delete this piece"
              pendingLabel="Deleting"
              fields={<input type="hidden" name="id" value={piece.id} />}
            />
          </div>
          <p className="mt-3 max-w-[40ch] text-sm text-ink-3">
            Hold to delete, photo and all. To keep a record, set it aside instead.
          </p>
        </section>
      </div>
    </div>
  )
}

/** What a piece is worn for, when it is not every day. */
const WORN_FOR_LINE: Record<WornFor, string | null> = {
  everyday: null,
  gym: 'for the gym',
  both: 'for the gym and every day',
}
