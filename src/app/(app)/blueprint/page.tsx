import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/button-link'
import { Swatch } from '@/components/cloth'
import { SectionHead } from '@/components/section'
import { isKeptOnRedraft, listSlots, type Slot } from '@/lib/blueprint'
import { band, day, money } from '@/lib/format'
import { getProfile } from '@/lib/profile'
import { colourNameFor, getGuide, type StoredGuide } from '@/lib/style-guide'
import { PRIORITIES, PRIORITY_LABELS, STATUS_LABELS } from '@/lib/wardrobe-values'

import { BlueprintSkeleton } from './skeletons'
import { SlotGroup, SlotLink, type SlotRow } from './slot-group'
import { DraftForm, GuideStep, RefillForm } from './steps'

export const metadata: Metadata = { title: 'Blueprint' }

/** Opens on the guide's palette, then says how big the wardrobe is; no title. */
export default function BlueprintPage() {
  return (
    <section>
      <Suspense fallback={<BlueprintSkeleton />}>
        <Content />
      </Suspense>
    </section>
  )
}

async function Content() {
  await connection()
  const [profile, guide, slots] = await Promise.all([getProfile(), getGuide(), listSlots()])

  if (!profile.confirmed_at || !profile.season) {
    return (
      <div className="mt-4">
        <p className="prose max-w-[44ch] text-[1.0625rem] text-ink-2">
          The blueprint is drafted from your style guide, and the guide from your colouring once you have confirmed it
          under You.
        </p>
        <ButtonLink href="/you" className="mt-6">
          Start your profile
        </ButtonLink>
      </div>
    )
  }

  if (!guide) {
    return (
      <div className="mt-4">
        <p className="prose max-w-[44ch] text-[1.0625rem] text-ink-2">
          First the style guide: your palette with real colours to shop for, proportion rules for your height and
          build, shoes, accessories and fit. The blueprint is drafted from it next.
        </p>
        <div className="mt-6">
          <GuideStep />
        </div>
      </div>
    )
  }

  const active = slots.filter((slot) => slot.status !== 'retired')
  const retired = slots.filter((slot) => slot.status === 'retired')
  const replaces = slots.filter((slot) => !isKeptOnRedraft(slot)).length

  if (slots.length === 0) {
    return (
      <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
        <PaletteRow guide={guide} />
        <div className="mt-12 lg:mt-0">
          <p className="prose max-w-[44ch] text-[1.0625rem] text-ink-2">
            Claude drafts the whole wardrobe from your profile and guide, in the order to buy it. You can then edit,
            reorder, retire or add to any of it.
          </p>
          <div className="mt-6">
            <DraftForm replaces={0} first />
          </div>
        </div>
      </div>
    )
  }

  // On the laptop the palette, the overview and "Add your own" hold the left
  // column and stay put while the slots scroll on the right.
  return (
    <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
      <div className="lg:sticky lg:top-12 lg:self-start">
        <PaletteRow guide={guide} />
        <Overview slots={active} />
        <div className="mt-8 hidden lg:block">
          <ButtonLink href="/blueprint/new" variant="quiet">
            Add your own
          </ButtonLink>
        </div>
      </div>

      <div className="max-w-3xl">
        {PRIORITIES.map((priority, index) => {
          const group = active.filter((slot) => slot.priority === priority)
          if (group.length === 0) return null
          return (
            <SlotGroup
              key={priority}
              title={PRIORITY_LABELS[priority].title}
              hint={PRIORITY_LABELS[priority].hint}
              summary={groupSummary(group)}
              rows={group.map((slot) => toRow(slot, guide))}
              first={index === 0}
            />
          )
        })}

        <div className="mt-8 lg:hidden">
          <ButtonLink href="/blueprint/new" variant="quiet">
            Add your own
          </ButtonLink>
        </div>

        {retired.length > 0 ? <Retired slots={retired} guide={guide} /> : null}

        <section aria-labelledby="redraft" className="mt-16">
          <SectionHead id="redraft" title="Redraft" />
          <p className="caption mt-1">Claude drafts the blueprint again from your profile and guide as they are now.</p>
          <div className="mt-5">
            <DraftForm replaces={replaces} first={false} />
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * The way into the guide: its best colours as a band across the phone's
 * screen, two rows of chips in the laptop's left column, named under it.
 */
function PaletteRow({ guide }: { guide: StoredGuide }) {
  const best = guide.palette.best
  const names = best.map((colour) => colour.name).join(', ')
  const drafted = guide.generated_at ? `, drafted ${day(guide.generated_at)}` : ''
  return (
    <div className="mt-2">
      <Link
        href="/blueprint/guide"
        aria-label={`Style guide: ${names}`}
        className="bleed pressable flex gap-px lg:mx-0 lg:grid lg:grid-cols-6 lg:overflow-hidden lg:rounded-[var(--radius-tile)]"
      >
        {best.map((colour, index) => (
          <Swatch key={`${index}-${colour.hex}`} colour={colour.hex} name={colour.name} className="h-16 min-w-0 flex-1 rounded-none!" />
        ))}
      </Link>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="caption">Style guide{drafted}</p>
        <Link href="/blueprint/guide" className="text-button -mr-2 shrink-0">
          Open
        </Link>
      </div>
    </div>
  )
}

/** The page's line: how big, how much of it is his, what the rest costs. */
function Overview({ slots }: { slots: Slot[] }) {
  const owned = slots.filter((slot) => slot.status === 'owned').length
  const toFind = slots.filter((slot) => slot.status === 'wanted' || slot.status === 'candidate')
  const min = toFind.reduce((sum, slot) => sum + (slot.budget_min_cents ?? 0), 0)
  const max = toFind.reduce((sum, slot) => sum + (slot.budget_max_cents ?? 0), 0)
  return (
    <div className="mt-10">
      <h1 className="display text-[2.5rem] tabular-nums sm:text-[3.25rem]">
        {slots.length} slots{owned ? `, ${owned} already yours` : ''}.
      </h1>
      {max > 0 ? (
        <p className="mt-3 text-[1.0625rem] text-ink-2 tabular-nums">
          The {owned ? 'rest' : 'whole wardrobe'} comes to about {money(min)} to {money(max)}.
        </p>
      ) : null}
    </div>
  )
}

/** "11 slots, 9 to find, about $1,850 to $3,200" for the wanted ones. */
function groupSummary(slots: Slot[]): string {
  const toFind = slots.filter((slot) => slot.status === 'wanted' || slot.status === 'candidate')
  const parts = [`${slots.length} ${slots.length === 1 ? 'slot' : 'slots'}`]
  if (toFind.length !== slots.length) parts.push(`${toFind.length} to find`)
  const min = toFind.reduce((sum, slot) => sum + (slot.budget_min_cents ?? 0), 0)
  const max = toFind.reduce((sum, slot) => sum + (slot.budget_max_cents ?? 0), 0)
  if (max > 0) parts.push(`about ${money(min)} to ${money(max)}`)
  return parts.join(', ')
}

function toRow(slot: Slot, guide: StoredGuide | null): SlotRow {
  return {
    id: slot.id,
    name: slot.name,
    why: slot.why,
    colours: slot.colours,
    colourNames: slot.colours.map((hex) => colourNameFor(guide, hex)),
    band: band(slot.budget_min_cents, slot.budget_max_cents),
    status: STATUS_LABELS[slot.status],
    owned: slot.status === 'owned',
  }
}

function Retired({ slots, guide }: { slots: Slot[]; guide: StoredGuide }) {
  return (
    <section aria-labelledby="retired" className="mt-16">
      <SectionHead id="retired" title="Retired" aside={`${slots.length} ${slots.length === 1 ? 'slot' : 'slots'}`} />
      <p className="caption mt-1">Out of the blueprint. Refill one and Claude proposes what takes its place.</p>
      <ul className="mt-3 divide-y divide-line">
        {slots.map((slot) => (
          <li key={slot.id}>
            <SlotLink row={toRow(slot, guide)} muted />
            <div className="pb-4 pl-14">
              {slot.refilled_by ? (
                <Link href={`/blueprint/${slot.refilled_by}`} className="text-button -ml-2">
                  See the refill
                </Link>
              ) : (
                <RefillForm id={slot.id} compact />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
