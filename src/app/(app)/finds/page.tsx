import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { Feed } from '@/components/feed/feed'
import { FeedSkeleton } from '@/components/feed/feed-skeleton'
import { StatementShelf, StatementShelfSkeleton } from '@/components/feed/statement-shelf'
import { SearchIcon } from '@/components/icons'

export const metadata: Metadata = { title: 'Finds' }

/**
 * The shopping tab: a line to ask the shops for something (which opens
 * Search), the way into the statement pieces, last night's finds by slot,
 * and the way into everything the finder read.
 */
export default function FindsPage() {
  return (
    <section>
      <Link href="/search" className="field pressable flex items-center gap-3 text-ink-3">
        <SearchIcon className="size-5 shrink-0" />
        <span>Ask the shops for something</span>
      </Link>
      <Suspense fallback={<StatementShelfSkeleton />}>
        <StatementShelf />
      </Suspense>
      <Suspense fallback={<FeedSkeleton />}>
        <Feed />
      </Suspense>
    </section>
  )
}
