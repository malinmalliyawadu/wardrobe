import type { Metadata } from 'next'
import { Suspense } from 'react'

import { StatusList, StatusSkeleton } from '@/components/status-list'

export const metadata: Metadata = { title: 'You' }

export default function YouPage() {
  return (
    <section>
      <h1 className="font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        You
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        A few photos, analysed by Claude and confirmed by you. Then your measurements, sizes,
        life in Wellington, taste and budget.
      </p>

      <h2 className="mt-12 text-sm font-medium text-ink-2">Profile</h2>
      <p className="mt-2 border-t border-line pt-4 text-ink-3">
        Nothing recorded yet. Photo capture and the confirmation flow are the next milestone.
      </p>

      <h2 className="mt-12 text-sm font-medium text-ink-2">Systems</h2>
      <div className="mt-2">
        <Suspense fallback={<StatusSkeleton />}>
          <StatusList />
        </Suspense>
      </div>
    </section>
  )
}
