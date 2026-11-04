import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { FormSkeleton } from '@/components/skeleton'
import { listSlots } from '@/lib/blueprint'
import { getProfile } from '@/lib/profile'
import { getGuide } from '@/lib/style-guide'

import { SlotForm } from '../slot-form'
import { ceilings, formValues, paletteSwatches } from '../slot-values'

export const metadata: Metadata = { title: 'Add a slot' }

export default function NewSlotPage() {
  return (
    <section>
      <BackLink href="/blueprint" label="Blueprint" />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Add a slot
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Something you want that the draft missed, or something you own that the blueprint
        should build around. A redraft keeps it.
      </p>
      <Suspense fallback={<FormSkeleton />}>
        <Form />
      </Suspense>
    </section>
  )
}

async function Form() {
  await connection()
  const [profile, guide, slots] = await Promise.all([getProfile(), getGuide(), listSlots()])
  // Keyed on the slot count, so coming back after adding one starts a fresh form.
  return (
    <SlotForm
      key={slots.length}
      initial={formValues(null)}
      {...paletteSwatches(guide)}
      ceilings={ceilings(profile)}
    />
  )
}
