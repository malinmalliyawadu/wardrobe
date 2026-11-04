import type { Metadata } from 'next'
import { connection } from 'next/server'
import { notFound } from 'next/navigation'
import { Suspense, type CSSProperties } from 'react'

import { BackLink } from '@/components/back-link'
import { ButtonLink } from '@/components/button-link'
import { FindCard } from '@/components/feed/find-card'
import { Bone, Skeleton, TextBone } from '@/components/skeleton'
import { usdText } from '@/lib/finder/settings'
import { getSearch, RUNNING, SCORE_USD_ESTIMATE, targetLine, type SearchView } from '@/lib/search'

import { Refresh } from './refresh'

export const metadata: Metadata = { title: 'Search' }

export default function SearchResultPage({ params }: PageProps<'/search/[id]'>) {
  return (
    <section>
      <BackLink href="/search" label="Search" />
      <Suspense fallback={<ResultSkeleton />}>
        <Content params={params} />
      </Suspense>
    </section>
  )
}

async function Content({ params }: { params: PageProps<'/search/[id]'>['params'] }) {
  await connection()
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const search = await getSearch(id)
  if (!search) notFound()
  const running = RUNNING.includes(search.status)

  return (
    <>
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        {search.summary ?? `“${search.request}”`}
      </h1>
      {/* What was understood, once it is; until then the progress below says it is reading. */}
      {search.target ? (
        <p className="mt-4 max-w-[44ch] text-[1.0625rem] leading-relaxed text-ink-2">{targetLine(search.target)}</p>
      ) : null}

      {running ? (
        <>
          <Progress search={search} />
          <Refresh />
        </>
      ) : search.status === 'failed' ? (
        <div className="mt-10 border-t border-line pt-6">
          <p role="alert" className="max-w-[44ch] text-ink-2">
            {search.error ?? 'It did not finish.'}
          </p>
          <ButtonLink href="/search" variant="quiet" className="mt-6">
            Search again
          </ButtonLink>
        </div>
      ) : (
        <Results search={search} />
      )}
    </>
  )
}

/**
 * Where the search is, in words, with a hairline that fills as Claude judges.
 * The line moves by transform only; with reduced motion it jumps.
 */
function Progress({ search }: { search: SearchView }) {
  const { status, offered, scored } = search
  const stats = search.stats
  const text =
    status === 'reading'
      ? 'Reading what you asked for.'
      : status === 'filtering'
        ? 'Looking through the shops for it in your size.'
        : status === 'scoring'
          ? offered === 0
            ? 'Nothing in the shops matched.'
            : `Judging the closest of ${(stats.candidates ?? offered).toLocaleString('en-NZ')} in your size: ${scored} done.`
          : 'Checking the shops for today’s price and stock.'
  const share =
    status === 'reading' ? 0.04 : status === 'filtering' ? 0.1 : status === 'scoring' ? 0.1 + 0.8 * fraction(search) : 0.95
  return (
    <div className="mt-10 border-t border-line pt-6" aria-live="polite">
      <p className="text-[0.9375rem] text-ink-2">{text}</p>
      <div className="mt-4 h-px w-full overflow-hidden bg-line">
        <div
          className="progress-line h-px w-full origin-left bg-brass"
          style={{ '--share': share } as CSSProperties}
        />
      </div>
      <p className="mt-3 text-sm text-ink-3">About a minute. You can leave; it keeps going.</p>
    </div>
  )
}

/** How far through what it can afford: the cap usually stops it before the end of the list. */
function fraction(search: SearchView): number {
  const affordable = Math.max(1, Math.floor(search.max_usd / SCORE_USD_ESTIMATE))
  const expected = Math.min(search.offered, affordable)
  return expected === 0 ? 0 : Math.min(1, search.scored / expected)
}

function Results({ search }: { search: SearchView }) {
  const { results, closest, stats } = search
  const judged = stats.scored ?? search.scored
  const pool = stats.candidates ?? 0
  const spent = usdText(Math.round(search.usd * 100) / 100)
  const capped = (stats.skipped_for_budget ?? 0) > 0
  const read =
    pool === 0
      ? `Nothing in the shops matched it in your size. Spent ${spent}.`
      : `Judged ${judged.toLocaleString('en-NZ')} of ${pool.toLocaleString('en-NZ')} in your size, closest to your words first${capped ? `, up to the ${usdText(search.max_usd)} limit` : ''}. Spent ${spent}.`
  return (
    <>
      <section aria-labelledby="results" className="mt-10 border-t border-line pt-8">
        <h2 id="results" className="font-display text-[1.75rem] leading-tight tracking-[-0.01em]">
          {results.length === 0 ? 'Nothing good enough' : closest ? 'The closest' : results.length === 1 ? 'One find' : `${results.length} finds`}
        </h2>
        <p className="mt-2 max-w-[44ch] text-[0.9375rem] text-ink-3">
          {read}
          {closest ? ' Nothing cleared the bar; these came nearest.' : ''}
          {results.length > 0 ? ' What you save goes to Saved on Today.' : ''}
        </p>
        {results.length > 0 ? (
          // The feed's row: a swipe row on the phone, a grid on a laptop.
          <div className="scroller -mx-5 mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-5 px-5 pb-2 lg:mx-0 lg:grid lg:snap-none lg:grid-cols-3 lg:gap-x-6 lg:gap-y-10 lg:overflow-visible lg:px-0 lg:pb-0">
            {results.map((find) => (
              <FindCard key={find.product_id} find={find} slotName={null} />
            ))}
          </div>
        ) : null}
      </section>

      {search.target ? (
        <section aria-labelledby="keep" className="mt-14 border-t border-line pt-8">
          <h2 id="keep" className="font-display text-[1.375rem] leading-tight">
            Want it every night?
          </h2>
          <p className="mt-2 max-w-[44ch] text-[0.9375rem] text-ink-2">
            Make it a blueprint slot and the nightly finder looks for it from now on.
          </p>
          <ButtonLink href={`/blueprint/new?search=${search.id}`} variant="quiet" className="mt-5">
            Add to blueprint
          </ButtonLink>
        </section>
      ) : null}
    </>
  )
}

function ResultSkeleton() {
  return (
    <Skeleton label="Loading the search">
      <span className="mt-2 flex h-[2.4rem] items-center text-[2.25rem] sm:h-[2.9rem] sm:text-[2.75rem]">
        <Bone className="h-[0.7em] w-3/4 rounded-full" />
      </span>
      <div className="mt-4 text-[1.0625rem]">
        <TextBone className="w-64 max-w-full" />
      </div>
      <div className="mt-10 border-t border-line pt-8">
        <span className="flex h-[2.1rem] items-center text-[1.75rem]">
          <Bone className="h-[0.7em] w-32 rounded-full" />
        </span>
        <div className="mt-6 flex gap-4 overflow-hidden">
          {[0, 1].map((card) => (
            <Bone key={card} className="aspect-[4/5] w-[15.5rem] shrink-0 rounded-xl" />
          ))}
        </div>
      </div>
    </Skeleton>
  )
}
