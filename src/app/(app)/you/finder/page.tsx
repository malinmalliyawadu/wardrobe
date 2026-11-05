import type { Metadata } from 'next'

import { SectionHead } from '@/components/section'
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
      intro="What the nightly finder and your searches may spend on Claude, and which shops they read."
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
        key={[settings.max_usd_per_run, settings.max_usd_per_month, settings.max_usd_per_search, settings.max_usd_statements, ...stores.filter((store) => store.enabled).map((store) => store.slug)].join('|')}
        settings={settings}
        stores={stores}
        perScore={spend.perScore}
      />
      <TryOnSummary spend={tryOns} />
    </>
  )
}

const ZONE = { timeZone: 'Pacific/Auckland' } as const

/** Two numbers side by side: a caption, the figure big, one line under it. */
function Figure({ caption, value, line }: { caption: string; value: string; line: string | null }) {
  return (
    <div>
      <dt className="caption">{caption}</dt>
      <dd className="headline mt-1 text-[1.75rem] tabular-nums">{value}</dd>
      {line ? <dd className="mt-1 text-sm text-ink-2">{line}</dd> : null}
    </div>
  )
}

function SpendSummary({ spend }: { spend: Spend }) {
  const last = spend.lastRun
  return (
    <dl className="mt-10 grid grid-cols-2 gap-x-4 lg:grid-cols-4">
      <Figure
        caption="Last run"
        value={last ? usdText(round(last.usd)) : 'None yet'}
        line={
          last
            ? `${last.scored.toLocaleString('en-NZ')} judged, ${(last.finished_at ?? last.started_at).toLocaleDateString('en-NZ', { weekday: 'long', ...ZONE })}`
            : null
        }
      />
      <Figure
        caption="This month"
        value={usdText(round(spend.thisMonth))}
        line={`${new Date().toLocaleDateString('en-NZ', { month: 'long', ...ZONE })}, New Zealand time`}
      />
    </dl>
  )
}

/**
 * Try-ons are billed by OpenAI, apart from the finder's Claude spend, and only
 * ever made one at a time when he asks, so there is no limit to set: the
 * numbers are here so the cost is known.
 */
function TryOnSummary({ spend }: { spend: TryOnSpend }) {
  const each = spend.count > 0 ? round(spend.usd / spend.count) : null
  return (
    <section aria-labelledby="try-ons" className="mt-12">
      <SectionHead id="try-ons" title="Try-ons" />
      <p className="mt-1 max-w-[44ch] text-sm text-ink-3">
        Made by OpenAI from your full-length photo and billed by OpenAI, not Anthropic.
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 lg:grid-cols-4">
        <Figure
          caption="This month"
          value={usdText(round(spend.thisMonthUsd))}
          line={`${spend.thisMonthCount === 1 ? '1 image' : `${spend.thisMonthCount} images`}, ${new Date().toLocaleDateString('en-NZ', { month: 'long', ...ZONE })}`}
        />
        <Figure
          caption="Each"
          value={each === null ? 'None yet' : usdText(each)}
          line={
            spend.count > 0
              ? `Average of ${spend.count === 1 ? 'the one' : `all ${spend.count}`} made`
              : 'Measured from the first'
          }
        />
      </dl>
    </section>
  )
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
