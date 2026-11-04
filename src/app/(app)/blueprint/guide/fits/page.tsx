import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { getGuide } from '@/lib/style-guide'

import { NoGuide } from '../no-guide'
import { FitsForm } from './form'

export const metadata: Metadata = { title: 'Edit fit by garment' }

export default function FitsPage() {
  return (
    <section>
      <BackLink href="/blueprint/guide" label="Style guide" />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Fit by garment
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Tick the retailer fit labels that work on you for each garment. The finder drops
        products cut any other way.
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
  return <FitsForm key={guide.edited_at?.toISOString() ?? 'drafted'} fits={guide.fit_vocabulary} />
}
