import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense, type ReactNode } from 'react'

import { BackLink } from '@/components/back-link'
import { Cloth } from '@/components/cloth'
import { day } from '@/lib/format'
import { label } from '@/lib/profile-values'
import { getProfile } from '@/lib/profile'
import { getGuide, type GuideColour, type Section } from '@/lib/style-guide'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

import { GuideStep } from '../steps'
import { SECTION_TITLES } from './titles'

export const metadata: Metadata = { title: 'Style guide' }

export default function GuidePage() {
  return (
    <section>
      <BackLink href="/blueprint" label="Blueprint" />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Style guide
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        What suits you, written from your confirmed profile. The blueprint is drafted from it,
        and the finder checks every product against it.
      </p>
      <Suspense fallback={<p className="mt-10 border-t border-line pt-6 text-ink-3">Loading the guide</p>}>
        <Content />
      </Suspense>
    </section>
  )
}

async function Content() {
  await connection()
  const [guide, profile] = await Promise.all([getGuide(), getProfile()])

  if (!guide) {
    return (
      <div className="mt-10 border-t border-line pt-8">
        <p className="max-w-[42ch] text-ink-2">
          {profile.confirmed_at
            ? 'No guide yet. Claude drafts it from your colouring, proportions and what you have typed in.'
            : 'The guide is built on your confirmed colouring, so confirm that first under You.'}
        </p>
        {profile.confirmed_at ? (
          <div className="mt-6">
            <GuideStep />
          </div>
        ) : null}
      </div>
    )
  }

  const { palette } = guide

  return (
    <>
      <Part title="Palette" edit="/blueprint/guide/palette">
        <p className="mt-4 max-w-[46ch] font-display text-[1.1875rem] leading-[1.45] text-ink">{palette.summary}</p>

        <h3 className="mt-10 text-sm font-medium text-ink-2">Best colours</h3>
        <SwatchGrid colours={palette.best} />

        <h3 className="mt-10 text-sm font-medium text-ink-2">Best neutrals</h3>
        <SwatchGrid colours={palette.neutrals} />

        {palette.avoid.length ? (
          <>
            <h3 className="mt-10 text-sm font-medium text-ink-2">Keep away from your face</h3>
            <ul className="mt-4 space-y-4">
              {palette.avoid.map((colour) => (
                <li key={colour.hex} className="flex items-start gap-4">
                  <Cloth colour={colour.hex} struck className="h-10 w-8 shrink-0 rounded-[0.3rem]" />
                  <div className="min-w-0">
                    <p className="font-medium first-letter:uppercase">{colour.name}</p>
                    <p className="text-sm text-ink-2 first-letter:uppercase">{colour.why}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h3 className="mt-10 text-sm font-medium text-ink-2">Metal</h3>
        <div className="mt-3 flex items-start gap-4">
          <MetalChip metal={palette.metal} />
          <div className="min-w-0">
            <p className="font-medium">{label(palette.metal)}</p>
            <p className="text-sm text-ink-2">{palette.metal_why}</p>
          </div>
        </div>
      </Part>

      <RulesPart name="silhouette" section={guide.silhouette} />
      <RulesPart name="shoes" section={guide.shoes} />
      <RulesPart name="accessories" section={guide.accessories} />

      <Part title="Fit by garment" edit="/blueprint/guide/fits">
        <p className="mt-3 max-w-[44ch] text-ink-2">The retailer fit labels that work on you. The finder skips the rest.</p>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {guide.fit_vocabulary.map((entry) => (
            <div key={entry.garment} className="grid gap-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
              <dt className="font-medium">{GARMENT_LABELS[entry.garment]}</dt>
              <dd>
                <p className="text-[0.9375rem] text-ink">{entry.fits.map(label).join(' or ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</p>
                {entry.note ? <p className="mt-0.5 text-sm text-ink-2">{entry.note}</p> : null}
              </dd>
            </div>
          ))}
        </dl>
      </Part>

      <div className="mt-16 border-t border-line pt-8">
        <p className="text-sm text-ink-3">
          {guide.generated_at ? `Drafted ${day(guide.generated_at)}` : 'Drafted'}
          {guide.edited_at ? `, edited ${day(guide.edited_at)}` : ''}. Redrafting replaces your edits; the
          blueprint stays as it is until you redraft that too.
        </p>
        <div className="mt-5">
          <GuideStep again />
        </div>
      </div>
    </>
  )
}

function Part({ title, edit, children }: { title: string; edit: string; children: ReactNode }) {
  const id = `part-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section aria-labelledby={id} className="mt-14 first-of-type:mt-10">
      <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
        <h2 id={id} className="font-display text-[1.625rem] leading-tight tracking-[-0.005em]">
          {title}
        </h2>
        <Link href={edit} className="text-button -mr-2 shrink-0" aria-label={`Edit ${title.toLowerCase()}`}>
          Edit
        </Link>
      </div>
      {children}
    </section>
  )
}

function RulesPart({ name, section }: { name: keyof typeof SECTION_TITLES; section: Section }) {
  return (
    <Part title={SECTION_TITLES[name]} edit={`/blueprint/guide/${name}`}>
      <p className="mt-4 max-w-[46ch] text-[1.0625rem] leading-relaxed text-ink">{section.summary}</p>
      <dl className="mt-6 space-y-5">
        {section.rules.map((rule) => (
          <div key={rule.topic} className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-medium first-letter:uppercase">{rule.topic}</dt>
            <dd className="max-w-[60ch] text-[0.9375rem] leading-relaxed text-ink-2">{rule.rule}</dd>
          </div>
        ))}
      </dl>
    </Part>
  )
}

function SwatchGrid({ colours }: { colours: GuideColour[] }) {
  return (
    <ul className="mt-4 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4">
      {colours.map((colour) => (
        <li key={colour.hex}>
          <Cloth colour={colour.hex} className="aspect-[4/5] w-full rounded-[0.5rem]" />
          <p className="mt-2 text-[0.9375rem] font-medium leading-snug first-letter:uppercase">{colour.name}</p>
          <p className="mt-0.5 text-sm leading-snug text-ink-3 first-letter:uppercase">{colour.use}</p>
        </li>
      ))}
    </ul>
  )
}

/** The metal as two small studs. Solid colours, not a gradient. */
function MetalChip({ metal }: { metal: 'gold' | 'silver' | 'mixed' }) {
  const gold = '#b08d3c'
  const silver = '#b4b7bc'
  const studs = metal === 'mixed' ? [gold, silver] : metal === 'gold' ? [gold, gold] : [silver, silver]
  return (
    <span className="flex w-8 shrink-0 justify-between pt-1" aria-hidden>
      {studs.map((colour, index) => (
        <span
          key={index}
          className="size-3.5 rounded-full border border-[var(--swatch-edge)]"
          style={{ backgroundColor: colour, boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.4)' }}
        />
      ))}
    </span>
  )
}
