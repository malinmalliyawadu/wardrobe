import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { SlotSwatches } from '@/components/cloth'
import { HoldButton } from '@/components/hold-button'
import { getSlot } from '@/lib/blueprint'
import { day } from '@/lib/format'
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
  const [slot, guide, profile] = await Promise.all([
    Number.isInteger(id) && id > 0 ? getSlot(id) : null,
    getGuide(),
    getProfile(),
  ])

  if (!slot) {
    return (
      <>
        <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05]">Slot not found</h1>
        <p className="mt-4 text-ink-2">
          It may have been deleted or replaced by a redraft.{' '}
          <Link href="/blueprint" className="text-brass underline decoration-brass/40 underline-offset-4">
            Back to the blueprint
          </Link>
          .
        </p>
      </>
    )
  }

  const origin = slot.source === 'malin' ? 'Added by you' : 'Drafted by Claude'
  const edited = slot.edited_at ? `, edited ${day(slot.edited_at)}` : ''

  return (
    <>
      <div className="mt-2 flex items-start gap-4">
        <h1 className="min-w-0 flex-1 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
          {slot.name}
        </h1>
        <div className="mt-1 origin-top-right scale-125">
          <SlotSwatches colours={slot.colours} names={slot.colours.map((hex) => colourNameFor(guide, hex))} />
        </div>
      </div>
      <p className="mt-4 max-w-[42ch] text-[1.0625rem] leading-relaxed text-ink-2">{slot.why}</p>
      <p className="mt-3 text-sm text-ink-3">
        {GARMENT_LABELS[slot.garment_type]}. {origin}
        {edited}.
      </p>

      <div className="mt-8 border-t border-line pt-6">
        <StatusControl key={slot.status} id={slot.id} status={slot.status} />
      </div>

      {slot.status === 'retired' ? (
        <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-4">
          {slot.refilled_by ? (
            <p className="text-[0.9375rem] text-ink-2">
              Already refilled.{' '}
              <Link href={`/blueprint/${slot.refilled_by}`} className="text-brass underline decoration-brass/40 underline-offset-4">
                See what took its place
              </Link>
              .
            </p>
          ) : (
            <RefillForm id={slot.id} />
          )}
        </div>
      ) : null}

      <h2 className="mt-12 border-t border-line pt-6 font-display text-[1.625rem] leading-tight">Details</h2>
      <p className="mt-2 text-sm text-ink-3">Editing a slot makes it yours: a redraft keeps it.</p>
      <SlotForm
        key={`${slot.id}-${slot.edited_at?.toISOString() ?? 'draft'}`}
        id={slot.id}
        initial={formValues(slot)}
        {...paletteSwatches(guide)}
        ceilings={ceilings(profile)}
      />

      <div className="mt-14 border-t border-line pt-8">
        <HoldButton
          action={removeSlot}
          label="Delete this slot"
          pendingLabel="Deleting"
          fields={<input type="hidden" name="id" value={slot.id} />}
        />
        <p className="mt-3 max-w-[40ch] text-sm text-ink-3">
          Hold to delete. To take it out of the blueprint but keep a record, set it to retired instead.
        </p>
      </div>
    </>
  )
}
