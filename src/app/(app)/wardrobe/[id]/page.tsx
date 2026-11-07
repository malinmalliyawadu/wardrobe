import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { SubmitButton } from '@/components/form'
import { HoldButton } from '@/components/hold-button'
import { PieceImage } from '@/components/piece-image'
import { SectionHead } from '@/components/section'
import { day, list, lookWearLine, wearLine } from '@/lib/format'
import { dressable, OCCASION_LABELS, readinessAround, readPieceLooks, todayNz, type PieceLooks } from '@/lib/looks'
import { fillableSlots, getPiece, inPalette, listPieces, type Piece } from '@/lib/pieces'
import { colourNameFor, getGuide } from '@/lib/style-guide'
import { GARMENT_LABELS, type WornFor } from '@/lib/wardrobe-values'
import { wearOf } from '@/lib/wear'

import { removePiece, restore, setAsidePiece } from '../actions'
import { LookCard } from '../look-card'
import { MakePieceLooks } from '../piece-looks'
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
  const [piece, guide, slots, pieces, around, wear] = await Promise.all([
    valid ? getPiece(id) : null,
    getGuide(),
    valid ? fillableSlots(id) : [],
    listPieces(),
    valid ? readPieceLooks(id) : null,
    valid ? wearOf(id) : null,
  ])

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
  // The looks around it, when there are some, run across the whole page under the top spread.
  const spread = around !== null && around.looks.length > 0 && !piece.set_aside_at

  return (
    <div className="mt-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-x-12 lg:gap-y-0">
      <div className={`w-56 lg:w-72 ${spread ? '' : 'lg:row-span-2'}`}>
        <PieceImage piece={piece} colour={colour} sizes="18rem" thumb={false} className="aspect-[3/4] rounded-[var(--radius-tile)]" />
        <div className="mt-1">
          <PhotoButton id={piece.id} hasPhoto={piece.photo !== null} />
        </div>
      </div>

      <div className="mt-6 min-w-0 max-w-2xl lg:mt-0">
        <h1 className="display text-[2rem] sm:text-[2.5rem]">{piece.name}</h1>
        <p className="mt-3 text-[0.9375rem] text-ink-2">
          {[GARMENT_LABELS[piece.garment_type], colour, palette, WORN_FOR_LINE[piece.worn_for]].filter(Boolean).join(', ')}.
        </p>
        {wear ? (
          <p className="mt-2 text-[0.9375rem] text-ink-2">
            {wearLine(wear)}{' '}
            <Link href="/wardrobe/worn" className={LINK}>
              What you wear
            </Link>
          </p>
        ) : null}
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

        {piece.set_aside_at ? null : <WearIt piece={piece} pieces={pieces} hasGuide={guide !== null} around={around} />}
      </div>

      {spread && around ? (
        <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3">
          {around.looks.map((look) => (
            <LookCard
              key={look.id}
              look={look}
              today={todayNz()}
              occasion={OCCASION_LABELS[look.occasion]}
              wornLine={lookWearLine(look)}
            />
          ))}
        </div>
      ) : null}

      <div className="min-w-0 max-w-2xl lg:col-start-2">
        <section aria-labelledby="details" className={spread ? 'mt-16' : 'mt-12'}>
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

/**
 * A few looks that each wear this piece, made on a tap; or, until it can be
 * built on, what is missing. The looks themselves sit under the page's top
 * spread, three across on the laptop.
 */
function WearIt({
  piece,
  pieces,
  hasGuide,
  around,
}: {
  piece: Piece
  pieces: Piece[]
  hasGuide: boolean
  around: PieceLooks | null
}) {
  const latest = around?.latest ?? null
  const ready = readinessAround(piece, pieces)
  const named = dressable([piece]).length > 0
  const blocked = !hasGuide ? (
    <>
      Looks are put together against your style guide.{' '}
      <Link href="/blueprint" className={LINK}>
        Draft it
      </Link>{' '}
      first.
    </>
  ) : !named ? (
    'Say what kind of piece it is under Details, and looks can be built on it.'
  ) : !ready.ready ? (
    ready.gym ? `To build gym fits on it, mark ${list(ready.missing)} as gym kit.` : `To build looks on it, add ${list(ready.missing)}.`
  ) : null

  return (
    <section aria-labelledby="wear-it" className="mt-10">
      <SectionHead
        id="wear-it"
        title="Ways to wear it"
        aside={latest && around?.looks.length ? `Made ${day(latest.created_at)}` : undefined}
      />
      {blocked ? (
        <p className="mt-3 max-w-[48ch] text-[0.9375rem] leading-normal text-ink-2">{blocked}</p>
      ) : (
        <>
          <p className="mt-3 max-w-[48ch] text-[0.9375rem] leading-normal text-ink-2">
            {piece.worn_for === 'gym' ? 'A few gym fits' : 'A few looks'} around it, from the rest of your wardrobe.
            {latest?.note && around?.looks.length ? ` These were for "${latest.note}".` : ''}
          </p>
          <div className="mt-5">
            <MakePieceLooks id={piece.id} again={(around?.looks.length ?? 0) > 0} />
          </div>
        </>
      )}
    </section>
  )
}

/** What a piece is worn for, when it is not every day. */
const WORN_FOR_LINE: Record<WornFor, string | null> = {
  everyday: null,
  gym: 'for the gym',
  both: 'for the gym and every day',
}
