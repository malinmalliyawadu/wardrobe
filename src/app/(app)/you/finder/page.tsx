import type { Metadata } from 'next'

import { Live, SubPage } from '@/components/sub-page'
import { liveRun } from '@/lib/finder/runs'
import { getFinderSettings, getSpend, storeCounts, usdText, type Spend } from '@/lib/finder/settings'
import { tryOnSpend, type TryOnSpend } from '@/lib/try-on'

import { FinderForm } from './form'
import { RunNow } from './run-now'

export const metadata: Metadata = { title: 'Finder' }

export default function FinderPage() {
  return (
    <SubPage
      title="Finder"
      intro="What the nightly finder and your searches may spend on Claude, and which shops they read. The finder judges the most important slots first and stops at the limit; whatever is left waits for the next night."
    >
      <Live>
        <Loaded />
      </Live>
    </SubPage>
  )
}

async function Loaded() {
  const [settings, spend, stores, tryOns, run] = await Promise.all([
    getFinderSettings(),
    getSpend(),
    storeCounts(),
    tryOnSpend(),
    liveRun(),
  ])
  return (
    <>
      <SpendSummary spend={spend} />
      <RunNow run={run} />
      <FinderForm
        key={[settings.max_usd_per_run, settings.max_usd_per_month, settings.max_usd_per_search, ...stores.filter((store) => store.enabled).map((store) => store.slug)].join('|')}
        settings={settings}
        stores={stores}
        perScore={spend.perScore}
      />
      <TryOnSummary spend={tryOns} />
    </>
  )
}

/**
 * Try-ons are billed by OpenAI, apart from the finder's Claude spend, and only
 * ever made one at a time when he asks, so there is no limit to set: the
 * numbers are here so the cost is known.
 */
function TryOnSummary({ spend }: { spend: TryOnSpend }) {
  const zone = { timeZone: 'Pacific/Auckland' } as const
  const each = spend.count > 0 ? round(spend.usd / spend.count) : null
  return (
    <section aria-labelledby="try-ons" className="mt-12">
      <h2 id="try-ons" className="font-display text-[1.375rem] leading-tight">
        Try-ons
      </h2>
      <p className="mt-2 max-w-[44ch] text-[0.9375rem] text-ink-2">
        “See it on me” on a find, made by OpenAI from your full-length photo and billed by OpenAI, not Anthropic.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 border-y border-line py-4">
        <div>
          <dt className="text-sm text-ink-3">This month</dt>
          <dd className="mt-0.5 font-display text-[1.5rem] leading-tight tabular-nums">
            {usdText(round(spend.thisMonthUsd))}
          </dd>
          <dd className="text-sm text-ink-2">
            {spend.thisMonthCount === 1 ? '1 image' : `${spend.thisMonthCount} images`},{' '}
            {new Date().toLocaleDateString('en-NZ', { month: 'long', ...zone })}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-3">Each</dt>
          <dd className="mt-0.5 font-display text-[1.5rem] leading-tight tabular-nums">
            {each === null ? 'None yet' : usdText(each)}
          </dd>
          <dd className="text-sm text-ink-2">
            {spend.count > 0
              ? `Average of ${spend.count === 1 ? 'the one' : `all ${spend.count}`} made`
              : 'Measured from the first'}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function SpendSummary({ spend }: { spend: Spend }) {
  const zone = { timeZone: 'Pacific/Auckland' } as const
  const last = spend.lastRun
  return (
    <dl className="mt-8 grid grid-cols-2 gap-x-4 border-y border-line py-4">
      <div>
        <dt className="text-sm text-ink-3">Last run</dt>
        <dd className="mt-0.5 font-display text-[1.5rem] leading-tight tabular-nums">
          {last ? usdText(round(last.usd)) : 'None yet'}
        </dd>
        {last ? (
          <dd className="text-sm text-ink-2">
            {last.scored.toLocaleString('en-NZ')} judged,{' '}
            {(last.finished_at ?? last.started_at).toLocaleDateString('en-NZ', { weekday: 'long', ...zone })}
          </dd>
        ) : null}
      </div>
      <div>
        <dt className="text-sm text-ink-3">This month</dt>
        <dd className="mt-0.5 font-display text-[1.5rem] leading-tight tabular-nums">{usdText(round(spend.thisMonth))}</dd>
        <dd className="text-sm text-ink-2">
          {new Date().toLocaleDateString('en-NZ', { month: 'long', ...zone })}, New Zealand time
        </dd>
      </div>
    </dl>
  )
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
