import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { Feed } from '@/components/feed/feed'
import { FeedSkeleton } from '@/components/feed/feed-skeleton'
import { SearchIcon } from '@/components/icons'

export const metadata: Metadata = { title: 'Finds' }

/**
 * The shopping tab: a line to ask the shops for something (which opens
 * Search), last night's finds by slot, what he saved and what changed since,
 * and the way into everything the finder read.
 */
export default function FindsPage() {
  return (
    <section>
      <Link href="/search" className="field pressable flex items-center gap-3 text-ink-3">
        <SearchIcon className="size-5 shrink-0" />
        <span>Ask the shops for something</span>
      </Link>
      <Suspense fallback={<FeedSkeleton />}>
        <Feed />
      </Suspense>
    </section>
  )
}
