import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { getGuide } from '@/lib/style-guide'

import { NoGuide } from '../no-guide'
import { PaletteForm } from './form'

export const metadata: Metadata = { title: 'Edit palette' }

export default function PalettePage() {
  return (
    <section>
      <BackLink href="/blueprint/guide" label="Style guide" />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Palette
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Slots take their colours from here, and the finder checks products against it. Tap a
        swatch to pick by eye, or type the hex.
      </p>
      <Suspense fallback={<p className="mt-8 text-ink-3">Loading</p>}>
        <Loaded />
      </Suspense>
    </section>
  )
}

async function Loaded() {
  await connection()
  const guide = await getGuide()
  if (!guide) return <NoGuide />
  return <PaletteForm key={guide.edited_at?.toISOString() ?? 'drafted'} palette={guide.palette} />
}
