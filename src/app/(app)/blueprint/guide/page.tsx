import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense, type CSSProperties, type ReactNode } from 'react'

import { BackLink } from '@/components/back-link'
import { Swatch } from '@/components/cloth'
import { SectionHead } from '@/components/section'
import { day } from '@/lib/format'
import { label } from '@/lib/profile-values'
import { getProfile } from '@/lib/profile'
import { getGuide, type GuideColour, type Section } from '@/lib/style-guide'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

import { GuideSkeleton } from '../skeletons'
import { GuideStep } from '../steps'
import { SECTION_TITLES } from './titles'

export const metadata: Metadata = { title: 'Style guide' }

/** Opens on the palette itself; the guide's name is only for a screen reader. */
export default function GuidePage() {
  return (
    <section>
      <BackLink href="/blueprint" label="Blueprint" />
      <h1 className="sr-only">Style guide</h1>
      <Suspense fallback={<GuideSkeleton />}>
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
      <div className="mt-6">
        <p className="prose max-w-[44ch] text-[1.0625rem] text-ink-2">
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
      <Part title="Palette" edit="/blueprint/guide/palette" first>
        <p className="prose mt-3 max-w-[60ch] text-[1.0625rem] text-ink">{palette.summary}</p>

        <p className="caption mt-8">Best colours</p>
        <SwatchGrid colours={palette.best} />

        <p className="caption mt-8">Best neutrals</p>
        <SwatchGrid colours={palette.neutrals} />

        {palette.avoid.length ? (
          <>
            <p className="caption mt-8">Keep away from your face</p>
            <SwatchGrid colours={palette.avoid.map((colour) => ({ hex: colour.hex, name: colour.name, use: colour.why }))} struck />
          </>
        ) : null}

        <p className="caption mt-8">Metal</p>
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
        <p className="prose mt-3 max-w-[60ch] text-[1.0625rem] text-ink">
          The retailer fit labels that work on you. The finder skips the rest.
        </p>
        <dl className="mt-5 max-w-3xl divide-y divide-line">
          {guide.fit_vocabulary.map((entry) => (
            <div key={entry.garment} className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
              <dt className="font-medium">{GARMENT_LABELS[entry.garment]}</dt>
              <dd>
                <p className="text-[0.9375rem] text-ink">{entry.fits.map(label).join(' or ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</p>
                {entry.note ? <p className="mt-0.5 text-sm text-ink-2">{entry.note}</p> : null}
              </dd>
            </div>
          ))}
        </dl>
      </Part>

      <section aria-labelledby="redraft-guide" className="mt-16">
        <SectionHead
          id="redraft-guide"
          title="Redraft"
          aside={
            guide.generated_at
              ? `Drafted ${day(guide.generated_at)}${guide.edited_at ? `, edited ${day(guide.edited_at)}` : ''}`
              : undefined
          }
        />
        <p className="caption mt-1">
          Redrafting replaces your edits. The blueprint stays as it is until you redraft that too.
        </p>
        <div className="mt-5">
          <GuideStep again />
        </div>
      </section>
    </>
  )
}

function Part({ title, edit, first = false, children }: { title: string; edit: string; first?: boolean; children: ReactNode }) {
  const id = `part-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section aria-labelledby={id} className={first ? 'mt-4' : 'mt-14'}>
      <SectionHead
        id={id}
        title={title}
        aside={
          <Link href={edit} className="text-button -mr-2" aria-label={`Edit ${title.toLowerCase()}`}>
            Edit
          </Link>
        }
      />
      {children}
    </section>
  )
}

function RulesPart({ name, section }: { name: keyof typeof SECTION_TITLES; section: Section }) {
  return (
    <Part title={SECTION_TITLES[name]} edit={`/blueprint/guide/${name}`}>
      <p className="prose mt-3 max-w-[60ch] text-[1.0625rem] text-ink">{section.summary}</p>
      <dl className="mt-5 max-w-3xl divide-y divide-line">
        {section.rules.map((rule) => (
          <div key={rule.topic} className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-medium first-letter:uppercase">{rule.topic}</dt>
            <dd className="prose max-w-[60ch] text-[0.9375rem] text-ink-2">{rule.rule}</dd>
          </div>
        ))}
      </dl>
    </Part>
  )
}

/** Colours as tiles, each named and told where it works (or, struck, why not). */
function SwatchGrid({ colours, struck = false }: { colours: GuideColour[]; struck?: boolean }) {
  return (
    <ul className="mt-3 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
      {colours.map((colour) => (
        <li key={colour.hex}>
          <Swatch colour={colour.hex} name={colour.name} struck={struck} className="aspect-[4/5] w-full" />
          <p className="mt-1.5 text-[0.9375rem] font-medium leading-snug first-letter:uppercase">{colour.name}</p>
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
  const name = (colour: string) => (colour === gold ? 'gold' : 'silver')
  return (
    <span className="flex w-8 shrink-0 justify-between pt-1" aria-hidden>
      {studs.map((colour, index) => (
        <span key={index} data-colour={name(colour)} className="swatch size-3.5 rounded-full" style={{ '--swatch': colour } as CSSProperties} />
      ))}
    </span>
  )
}
