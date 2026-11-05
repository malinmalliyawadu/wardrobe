import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { HubRow } from '@/components/hub-row'
import { PageTitle, SectionHead } from '@/components/section'
import { TextBone } from '@/components/skeleton'
import { StatusList, StatusSkeleton } from '@/components/status-list'
import { parseStoredAnalysis } from '@/lib/analysis'
import { listPhotos } from '@/lib/photos'
import { getFinderSettings, getSpend, usdText, type FinderSettings, type Spend } from '@/lib/finder/settings'
import { db } from '@/lib/db'
import { day } from '@/lib/format'
import { getProfile, type Profile } from '@/lib/profile'
import { listRetailers } from '@/lib/retailers'
import { seasonName } from '@/lib/seasons'

export const metadata: Metadata = { title: 'You' }

const ROWS = ['Photos', 'Colouring and proportions', 'Height and sizes', 'Your week', 'Taste', 'Budget', 'Finder']

export default function YouPage() {
  return (
    <section className="lg:grid lg:grid-cols-2 lg:gap-16">
      <div className="max-w-2xl">
        <Suspense fallback={<HubSkeleton />}>
          <Hub />
        </Suspense>
      </div>

      <section aria-labelledby="systems" className="mt-12 max-w-2xl lg:mt-0">
        <SectionHead id="systems" title="Systems" />
        <div className="mt-2">
          <Suspense fallback={<StatusSkeleton />}>
            <StatusList />
          </Suspense>
        </div>
      </section>
    </section>
  )
}

async function Hub() {
  await connection()
  const [profile, photos, finder, spend, stores] = await Promise.all([
    getProfile(),
    listPhotos(),
    getFinderSettings(),
    getSpend(),
    listRetailers(db()),
  ])
  const analysis = parseStoredAnalysis(profile.analysis)

  const colouring =
    profile.confirmed_at && profile.season
      ? { text: `${seasonName(profile.season)}, confirmed ${day(profile.confirmed_at)}`, filled: true }
      : analysis
        ? { text: `${seasonName(analysis.colouring.season.value)} proposed, waiting for you`, filled: true }
        : { text: photos.length ? 'Ready to read' : 'Needs photos first', filled: false }

  return (
    <>
      <PageTitle title="You" line={colouring.filled ? colouring.text : 'No read yet'} />
      <ul className="mt-10 divide-y divide-line">
        <HubRow
          href="/you/photos"
          title="Photos"
          summary={photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}` : 'None yet'}
          filled={photos.length > 0}
          aside={
            photos.length ? (
              <div className="flex -space-x-2">
                {photos.slice(0, 3).map((photo) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={photo.id}
                    src={`/photos/${photo.id}?v=thumb`}
                    alt=""
                    width="32"
                    height="32"
                    className="size-8 rounded-full border-2 border-ground object-cover"
                  />
                ))}
              </div>
            ) : null
          }
        />
        <HubRow href="/you/colouring" title="Colouring and proportions" summary={colouring.text} filled={colouring.filled} />
        <HubRow href="/you/sizes" title="Height and sizes" {...sizesSummary(profile)} />
        <HubRow href="/you/life" title="Your week" {...lifeSummary(profile)} />
        <HubRow href="/you/taste" title="Taste" {...tasteSummary(profile)} />
        <HubRow href="/you/budget" title="Budget" {...budgetSummary(profile)} />
        <HubRow
          href="/you/finder"
          title="Finder"
          {...finderSummary(finder, spend, stores.filter((store) => store.enabled).length, stores.length)}
        />
      </ul>
    </>
  )
}

function sizesSummary(profile: Profile): { summary: string; filled: boolean } {
  const parts: string[] = []
  if (profile.height_cm) parts.push(`${profile.height_cm} cm`)
  if (profile.sizes.tee) parts.push(profile.sizes.tee)
  if (profile.sizes.chest_cm) parts.push(`chest ${profile.sizes.chest_cm}`)
  if (profile.sizes.waist_cm) parts.push(`waist ${profile.sizes.waist_cm}`)
  if (profile.sizes.shoe_eu) parts.push(`EU ${profile.sizes.shoe_eu}`)
  return parts.length ? { summary: parts.join(', '), filled: true } : { summary: 'Not set', filled: false }
}

function lifeSummary(profile: Profile): { summary: string; filled: boolean } {
  const { office, gym, gym_days, running, evenings_out } = profile.life
  const parts: string[] = []
  if (office) parts.push(`office ${office}`)
  if (gym_days?.length) parts.push(`gym ${gym_days.length}`)
  else if (gym) parts.push(`gym ${gym}`)
  if (running) parts.push(`runs ${running}`)
  if (evenings_out) parts.push(`evenings out ${evenings_out}`)
  return parts.length
    ? { summary: `${parts.join(', ')} a week`, filled: true }
    : { summary: 'Not set', filled: false }
}

function tasteSummary(profile: Profile): { summary: string; filled: boolean } {
  const text = profile.taste.references ?? profile.taste.owned ?? profile.taste.no_gos
  if (!text) return { summary: 'Not set', filled: false }
  return { summary: text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text, filled: true }
}

function budgetSummary(profile: Profile): { summary: string; filled: boolean } {
  const { monthly, outerwear, shoes } = profile.budget
  const parts: string[] = []
  if (monthly) parts.push(`$${monthly} a month`)
  if (outerwear) parts.push(`outerwear to $${outerwear}`)
  if (shoes) parts.push(`shoes to $${shoes}`)
  return parts.length ? { summary: parts.join(', '), filled: true } : { summary: 'Not set', filled: false }
}

function finderSummary(
  settings: FinderSettings,
  spend: Spend,
  on: number,
  total: number,
): { summary: string; filled: boolean } {
  const parts = [
    settings.max_usd_per_run > 0 ? `${usdText(settings.max_usd_per_run)} a night` : 'Judging off',
    `${usdText(Math.round(spend.thisMonth * 100) / 100)} this month`,
    total === 0 ? 'shops added on the first run' : on === total ? `all ${total} shops` : `${on} of ${total} shops`,
  ]
  return { summary: parts.join(', '), filled: true }
}

/** The name and the rows' titles are known before the data, so they show at once; only the lines wait. */
function HubSkeleton() {
  return (
    <>
      <PageTitle
        title="You"
        line={
          <span className="skeleton block" aria-busy aria-label="Loading your profile">
            <TextBone className="w-56 max-w-full" />
          </span>
        }
      />
      <ul className="mt-10 divide-y divide-line" aria-busy>
        {ROWS.map((title, index) => (
          <li key={title} className="flex min-h-16 items-center py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{title}</p>
              <div className="skeleton">
                <TextBone className={['w-40', 'w-52', 'w-36', 'w-48', 'w-32', 'w-44', 'w-56'][index]} size="text-sm" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
