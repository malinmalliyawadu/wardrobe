import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { Bone, Skeleton, TextBone } from '@/components/skeleton'
import { whenSaid } from '@/lib/format'
import { getFinderSettings, getSpend, usdText } from '@/lib/finder/settings'
import { listSearches, RUNNING, searchBudget, type SearchSummary } from '@/lib/search'
import { getGuide } from '@/lib/style-guide'

import { SearchForm } from './search-form'

export const metadata: Metadata = { title: 'Search' }

export default function SearchPage() {
  return (
    <section>
      <h1 className="font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">Search</h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Something you want now, not only what the blueprint asks for. Say it the way you would to a shop assistant.
      </p>
      <Suspense fallback={<SearchSkeleton />}>
        <Content />
      </Suspense>
    </section>
  )
}

async function Content() {
  await connection()
  const [guide, settings, spend, searches] = await Promise.all([
    getGuide(),
    getFinderSettings(),
    getSpend(),
    listSearches(),
  ])

  if (!guide) {
    return (
      <p className="mt-10 border-t border-line pt-6 text-ink-2">
        Search judges what it finds against your style guide.{' '}
        <Link href="/blueprint" className="text-brass underline decoration-brass/40 underline-offset-4">
          Draft it
        </Link>{' '}
        first.
      </p>
    )
  }

  const budget = searchBudget(settings.max_usd_per_search, settings.max_usd_per_month, spend.thisMonth)
  const hint =
    budget > 0
      ? `Looks through what the shops had at the last nightly read, in your size, and judges the closest for up to ${usdText(budget)}. About a minute.`
      : 'Searching is off: its limit is spent or set to nothing on You, Finder.'
  return (
    <>
      <SearchForm hint={hint} />
      {searches.length > 0 ? <Recent searches={searches} /> : null}
    </>
  )
}

function Recent({ searches }: { searches: SearchSummary[] }) {
  const now = new Date()
  return (
    <section aria-labelledby="recent" className="mt-16 border-t border-line pt-8">
      <h2 id="recent" className="font-display text-[1.75rem] leading-tight tracking-[-0.01em]">
        Recent
      </h2>
      <ul className="mt-3 divide-y divide-line">
        {searches.map((search) => (
          <li key={search.id}>
            <Link href={`/search/${search.id}`} className="pressable -mx-2 flex min-h-16 items-center gap-4 rounded-lg px-2 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{search.summary ?? search.request}</span>
                <span className="block text-sm text-ink-3">{line(search, now)}</span>
              </span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="shrink-0 text-ink-3"
              >
                <path d="m9 5 7 7-7 7" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function line(search: SearchSummary, now: Date): string {
  const when = whenSaid(search.started_at, now)
  const said = when.charAt(0).toUpperCase() + when.slice(1)
  if (RUNNING.includes(search.status)) return `${said}, still searching`
  if (search.status === 'failed') return `${said}, did not finish`
  const finds = search.finds === 0 ? 'nothing over the bar' : `${search.finds} ${search.finds === 1 ? 'find' : 'finds'}`
  return `${said}, ${finds}, ${usdText(Math.round(search.usd * 100) / 100)}`
}

function SearchSkeleton() {
  return (
    <Skeleton label="Loading search">
      <div className="mt-8">
        <div className="mb-1.5 text-sm">
          <TextBone className="w-32" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Bone className="h-12 rounded-xl sm:flex-1" />
          <Bone className="h-12 w-28 rounded-full" />
        </div>
        <div className="mt-2 text-sm">
          <TextBone className="w-72 max-w-full" />
        </div>
      </div>
    </Skeleton>
  )
}
