import type { Metadata } from 'next'

import { Live, SubPage } from '@/components/sub-page'
import { getFinderSettings, getSpend, storeCounts, usdText, type Spend } from '@/lib/finder/settings'

import { FinderForm } from './form'

export const metadata: Metadata = { title: 'Finder' }

export default function FinderPage() {
  return (
    <SubPage
      title="Finder"
      intro="What the nightly finder may spend on Claude, and which shops it reads. It judges the most important slots first and stops at the limit; whatever is left waits for the next night."
    >
      <Live>
        <Loaded />
      </Live>
    </SubPage>
  )
}

async function Loaded() {
  const [settings, spend, stores] = await Promise.all([getFinderSettings(), getSpend(), storeCounts()])
  return (
    <>
      <SpendSummary spend={spend} />
      <FinderForm
        key={[settings.max_usd_per_run, settings.max_usd_per_month, ...stores.filter((store) => store.enabled).map((store) => store.slug)].join('|')}
        settings={settings}
        stores={stores}
        perScore={spend.perScore}
      />
    </>
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
