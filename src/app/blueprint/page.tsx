import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/button-link'
import { Cloth } from '@/components/cloth'
import { isKeptOnRedraft, listSlots, type Slot } from '@/lib/blueprint'
import { band, money } from '@/lib/format'
import { getProfile } from '@/lib/profile'
import { colourNameFor, getGuide, type StoredGuide } from '@/lib/style-guide'
import { PRIORITIES, PRIORITY_LABELS, STATUS_LABELS } from '@/lib/wardrobe-values'

import { SlotGroup, SlotLink, type SlotRow } from './slot-group'
import { DraftForm, GuideStep, RefillForm } from './steps'

export const metadata: Metadata = { title: 'Blueprint' }

export default function BlueprintPage() {
  return (
    <section>
      <h1 className="font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Blueprint
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Thirty to forty slots, each a specific item with a why, a priority and a budget. The
        nightly finder matches real products against the ones you want.
      </p>
      <Suspense fallback={<p className="mt-10 border-t border-line pt-6 text-ink-3">Loading the blueprint</p>}>
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
      <p className="mt-10 border-t border-line pt-6 text-ink-2">
        The blueprint is drafted from your style guide, and the guide from your confirmed colouring.{' '}
        <Link href="/you" className="text-brass underline decoration-brass/40 underline-offset-4">
          Start your profile
        </Link>{' '}
        first.
      </p>
    )
  }

  if (!guide) {
    return (
      <div className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-[1.625rem] leading-tight">First, your style guide</h2>
        <p className="mt-3 max-w-[42ch] text-ink-2">
          Your palette with real colours to shop for, proportion rules for your height and build,
          shoes, accessories and fit. You can edit every part of it, and the blueprint is drafted
          from it next.
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

  return (
    <>
      <GuideRow guide={guide} />

      {slots.length === 0 ? (
        <div className="mt-12">
          <h2 className="font-display text-[1.625rem] leading-tight">Now the blueprint</h2>
          <p className="mt-3 max-w-[42ch] text-ink-2">
            Claude drafts the whole wardrobe from your profile and guide, in the order to buy it.
            You can then edit, reorder, retire or add to any of it.
          </p>
          <div className="mt-6">
            <DraftForm replaces={0} first />
          </div>
        </div>
      ) : (
        <>
          <Overview slots={active} />
          {PRIORITIES.map((priority) => {
            const group = active.filter((slot) => slot.priority === priority)
            if (group.length === 0) return null
            return (
              <SlotGroup
                key={priority}
                title={PRIORITY_LABELS[priority].title}
                hint={PRIORITY_LABELS[priority].hint}
                summary={groupSummary(group)}
                rows={group.map((slot) => toRow(slot, guide))}
              />
            )
          })}

          <div className="mt-10">
            <ButtonLink href="/blueprint/new" variant="quiet">
              Add your own
            </ButtonLink>
          </div>

          {retired.length > 0 ? <Retired slots={retired} guide={guide} /> : null}

          <section aria-labelledby="redraft" className="mt-16 border-t border-line pt-8">
            <h2 id="redraft" className="font-display text-[1.625rem] leading-tight">
              Redraft
            </h2>
            <p className="mt-2 max-w-[42ch] text-ink-2">
              Claude drafts the blueprint again from your profile and guide as they are now.
            </p>
            <div className="mt-6">
              <DraftForm replaces={replaces} first={false} />
            </div>
          </section>
        </>
      )}
    </>
  )
}

/** The way into the guide, wearing the palette it holds. */
function GuideRow({ guide }: { guide: StoredGuide }) {
  return (
    <div className="mt-8 border-y border-line">
      <Link href="/blueprint/guide" className="pressable -mx-2 flex min-h-16 items-center gap-4 rounded-xl px-2 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Style guide</p>
          <p className="mt-0.5 text-sm text-ink-2">Palette, proportion, shoes, accessories and fit</p>
        </div>
        <div className="flex shrink-0 -space-x-1.5" aria-hidden>
          {guide.palette.best.slice(0, 5).map((colour) => (
            <Cloth key={colour.hex} colour={colour.hex} className="h-8 w-5 rounded-[0.25rem]" />
          ))}
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-ink-3">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </Link>
    </div>
  )
}

/** One sentence for the whole wardrobe: how big, how much of it is yours, what the rest costs. */
function Overview({ slots }: { slots: Slot[] }) {
  const owned = slots.filter((slot) => slot.status === 'owned').length
  const toFind = slots.filter((slot) => slot.status === 'wanted' || slot.status === 'candidate')
  const min = toFind.reduce((sum, slot) => sum + (slot.budget_min_cents ?? 0), 0)
  const max = toFind.reduce((sum, slot) => sum + (slot.budget_max_cents ?? 0), 0)
  const cost = max > 0 ? ` The ${owned ? 'rest comes' : 'whole wardrobe comes'} to about ${money(min)} to ${money(max)}.` : ''
  return (
    <p className="mt-10 max-w-[34ch] font-display text-[1.375rem] leading-snug text-ink">
      {slots.length} slots{owned ? `, ${owned} already yours` : ''}.{cost}
    </p>
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
      <div className="border-b border-line pb-3">
        <h2 id="retired" className="font-display text-[1.625rem] leading-tight">
          Retired
        </h2>
        <p className="mt-1 text-sm text-ink-3">Out of the blueprint. Refill one and Claude proposes what takes its place.</p>
      </div>
      <ul className="divide-y divide-line">
        {slots.map((slot) => (
          <li key={slot.id}>
            <SlotLink row={toRow(slot, guide)} muted />
            <div className="pb-4 pl-14">
              {slot.refilled_by ? (
                <Link href={`/blueprint/${slot.refilled_by}`} className="text-sm text-brass underline decoration-brass/40 underline-offset-4">
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
