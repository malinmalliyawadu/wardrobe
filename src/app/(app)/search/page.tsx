import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { HubRow } from '@/components/hub-row'
import { PageTitle, SectionHead } from '@/components/section'
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
      <PageTitle
        title="Ask the shops"
        line="Say what you are after the way you would to a shop assistant, and Claude looks through what the shops had last night."
      />
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
      <p className="mt-8 max-w-[44ch] text-ink-2">
        Search judges what it finds against your style guide.{' '}
        <Link href="/blueprint" className="text-accent underline decoration-accent/40 underline-offset-4">
          Draft it
        </Link>{' '}
        first.
      </p>
    )
  }

  const budget = searchBudget(settings.max_usd_per_search, settings.max_usd_per_month, spend.thisMonth)
  const hint =
    budget > 0
      ? `In your size, the closest judged first, for up to ${usdText(budget)}. About a minute.`
      : 'Searching is off: its limit is spent or set to nothing under You, Finder.'
  return (
    <>
      <SearchForm hint={hint} />
      {searches.length > 0 ? <Recent searches={searches} /> : null}
    </>
  )
}

/**
 * One list on the phone, two columns of rows on the laptop: the list is cut
 * in half so each column keeps its own hairlines, and on the phone the halves
 * stack in order with one hairline at the join.
 */
function Recent({ searches }: { searches: SearchSummary[] }) {
  const now = new Date()
  const middle = Math.ceil(searches.length / 2)
  const halves = [searches.slice(0, middle), searches.slice(middle)].filter((half) => half.length > 0)
  return (
    <section aria-labelledby="recent" className="mt-12">
      <SectionHead id="recent" title="Recent" aside={searches.length.toLocaleString('en-NZ')} />
      <div className="mt-1 lg:grid lg:grid-cols-2 lg:gap-x-16">
        {halves.map((half, index) => (
          <ul key={index} className={`divide-y divide-line ${index > 0 ? 'border-t border-line lg:border-t-0' : ''}`}>
            {half.map((search) => (
              <HubRow
                key={search.id}
                href={`/search/${search.id}`}
                title={search.summary ?? search.request}
                summary={line(search, now)}
                filled
              />
            ))}
          </ul>
        ))}
      </div>
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

/** The form: its label, the field and the button, and the hint under them. */
function SearchSkeleton() {
  return (
    <Skeleton label="Loading search">
      <div className="mt-8 max-w-2xl">
        <div className="mb-1.5 text-sm">
          <TextBone className="w-32" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Bone className="h-12 rounded-[var(--radius-control)] sm:flex-1" />
          <Bone className="h-12 w-28 rounded-[var(--radius-control)]" />
        </div>
        <div className="mt-2 text-sm">
          <TextBone className="w-72 max-w-full" />
        </div>
      </div>
    </Skeleton>
  )
}
