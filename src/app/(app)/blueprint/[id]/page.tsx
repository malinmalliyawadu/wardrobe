import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { SlotSwatches } from '@/components/cloth'
import { HoldButton } from '@/components/hold-button'
import { SectionHead } from '@/components/section'
import { getSlot } from '@/lib/blueprint'
import { day } from '@/lib/format'
import { pieceForSlot } from '@/lib/pieces'
import { getProfile } from '@/lib/profile'
import { colourNameFor, getGuide } from '@/lib/style-guide'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

import { removeSlot } from '../actions'
import { SlotSkeleton } from '../skeletons'
import { SlotForm } from '../slot-form'
import { ceilings, formValues, paletteSwatches } from '../slot-values'
import { StatusControl } from '../status-control'
import { RefillForm } from '../steps'

export const metadata: Metadata = { title: 'Slot' }

const inlineLink = 'text-accent underline decoration-accent/40 underline-offset-4'

export default function SlotPage({ params }: PageProps<'/blueprint/[id]'>) {
  return (
    <section>
      <BackLink href="/blueprint" label="Blueprint" />
      <Suspense fallback={<SlotSkeleton />}>
        <Content params={params} />
      </Suspense>
    </section>
  )
}

async function Content({ params }: Pick<PageProps<'/blueprint/[id]'>, 'params'>) {
  await connection()
  const { id: raw } = await params
  const id = Number(raw)
  const valid = Number.isInteger(id) && id > 0
  const [slot, guide, profile, piece] = await Promise.all([
    valid ? getSlot(id) : null,
    getGuide(),
    getProfile(),
    valid ? pieceForSlot(id) : null,
  ])

  if (!slot) {
    return (
      <>
        <h1 className="display mt-4 text-[2rem] sm:text-[2.5rem]">Slot not found</h1>
        <p className="mt-4 text-ink-2">
          It may have been deleted or replaced by a redraft.{' '}
          <Link href="/blueprint" className={inlineLink}>
            Back to the blueprint
          </Link>
          .
        </p>
      </>
    )
  }

  const origin = slot.source === 'malin' ? 'added by you' : 'drafted by Claude'
  const edited = slot.edited_at ? `, edited ${day(slot.edited_at)}` : ''

  // On the laptop the slot itself holds the left column and stays put; the
  // form scrolls on the right.
  return (
    <div className="mt-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
      <div className="lg:sticky lg:top-12 lg:self-start">
        <div className="flex items-start gap-4 lg:flex-col lg:gap-5">
          <SlotSwatches
            className="h-16 w-16"
            colours={slot.colours}
            names={slot.colours.map((hex) => colourNameFor(guide, hex))}
          />
          <h1 className="display min-w-0 flex-1 text-[2rem] sm:text-[2.5rem] lg:text-[2rem]">{slot.name}</h1>
        </div>
        <p className="prose mt-5 max-w-[44ch] text-[1.0625rem] text-ink-2">{slot.why}</p>
        <p className="mt-3 text-sm text-ink-3">
          {GARMENT_LABELS[slot.garment_type]}, {origin}
          {edited}
        </p>

        <div className="mt-10">
          <StatusControl key={slot.status} id={slot.id} status={slot.status} />
          {piece ? (
            <p className="mt-3 text-[0.9375rem] text-ink-2">
              In your wardrobe as{' '}
              <Link href={`/wardrobe/${piece.id}`} className={inlineLink}>
                {piece.name.toLowerCase()}
              </Link>
              .
            </p>
          ) : null}
        </div>

        {slot.status === 'retired' ? (
          <div className="mt-8">
            {slot.refilled_by ? (
              <p className="text-[0.9375rem] text-ink-2">
                Already refilled.{' '}
                <Link href={`/blueprint/${slot.refilled_by}`} className={inlineLink}>
                  See what took its place
                </Link>
                .
              </p>
            ) : (
              <RefillForm id={slot.id} />
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-12 max-w-2xl lg:mt-0">
        <SectionHead id="details" title="Details" />
        <p className="caption">Editing a slot makes it yours: a redraft keeps it.</p>
        <SlotForm
          key={`${slot.id}-${slot.edited_at?.toISOString() ?? 'draft'}`}
          id={slot.id}
          initial={formValues(slot)}
          {...paletteSwatches(guide)}
          ceilings={ceilings(profile)}
        />

        <div className="mt-14">
          <HoldButton
            action={removeSlot}
            label="Delete this slot"
            pendingLabel="Deleting"
            fields={<input type="hidden" name="id" value={slot.id} />}
          />
          <p className="prose mt-3 max-w-[40ch] text-sm text-ink-3">
            Hold to delete. To take it out of the blueprint but keep a record, set it to retired instead.
          </p>
        </div>
      </div>
    </div>
  )
}
