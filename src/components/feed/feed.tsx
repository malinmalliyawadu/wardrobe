import Link from 'next/link'
import { connection } from 'next/server'

import { ButtonLink } from '@/components/button-link'
import { SlotSwatches } from '@/components/cloth'
import { SectionHead } from '@/components/section'
import { CARDS_PER_SLOT, getFeed, type FeedGroup, type Run } from '@/lib/feed'
import { sizeGroup } from '@/lib/finder/classify'
import { usdText } from '@/lib/finder/settings'
import { getProfile } from '@/lib/profile'
import { colourNameFor, getGuide } from '@/lib/style-guide'
import { PRIORITY_LABELS } from '@/lib/wardrobe-values'

import { FindCard } from './find-card'

/**
 * Last night's finds by slot. Streams in after the shell; nothing here
 * animates on arrival, only in answer to a tap. What he saves goes to the
 * wishlist.
 */
export async function Feed() {
  await connection()
  const [feed, guide, profile] = await Promise.all([getFeed(), getGuide(), getProfile()])
  const name = (hex: string) => colourNameFor(guide, hex)

  // Until there is a blueprint there is nothing to look for.
  if (Object.keys(feed.slotNames).length === 0) {
    return (
      <div className="mt-10">
        <h1 className="display text-[2.5rem] sm:text-[3.25rem]">Nothing to look for yet.</h1>
        <p className="prose mt-4 max-w-[40ch] text-[1.0625rem] leading-normal text-ink-2">
          The finder reads the shops every night for the slots in your blueprint. Draft it, and its first finds are
          here in the morning.
        </p>
        <ButtonLink href="/blueprint" className="mt-8">
          Open the blueprint
        </ButtonLink>
      </div>
    )
  }

  const everything = (
    <section aria-labelledby="shops" className="mt-16">
      <SectionHead id="shops" title="Everything it read" />
      <p className="prose mt-2 max-w-[44ch] text-[0.9375rem] text-ink-2">
        Only what clears the bar for a slot is shown here. The rest, in every shop you have on, is a search away;
        what you save there or here goes to your wishlist.
      </p>
      <ButtonLink href="/shops" variant="quiet" size="small" className="mt-4">
        Browse the shops
      </ButtonLink>
    </section>
  )

  if (!feed.run) {
    return (
      <section aria-labelledby="finds" className="mt-10">
        <SectionHead id="finds" title="No finds yet" />
        <p className="prose mt-2 max-w-[40ch] text-[0.9375rem] text-ink-2">
          Every night the finder reads the shops for the slots in your blueprint. Its first finds will be here in
          the morning.
        </p>
      </section>
    )
  }

  const finds = feed.groups.reduce((total, group) => total + group.cards.length, 0)
  const sizes = profile.sizes
  const shows = (group: 'bottoms' | 'feet') => feed.groups.some((g) => sizeGroup(g.slot.garment_type) === group)
  const missing = [
    !sizes.waist_cm && shows('bottoms') ? { size: 'waist', garments: 'trousers' } : null,
    !(sizes.shoe_eu || sizes.shoe_uk || sizes.shoe_us) && shows('feet') ? { size: 'shoe size', garments: 'shoes' } : null,
  ].filter((item): item is { size: string; garments: string } => item !== null)

  return (
    <>
      <section aria-labelledby="finds" className="mt-10">
        <h1 id="finds" className="display text-[2.5rem] sm:text-[3.25rem]">
          {heading(feed.run, finds)}
        </h1>
        <p className="prose mt-3 max-w-[60ch] text-[0.9375rem] leading-normal text-ink-2">
          {runLine(feed.run, feed.total, feed.groups.length, finds < feed.total)}
        </p>
        {missing.length > 0 ? (
          <p className="prose mt-2 max-w-[44ch] text-[0.9375rem] text-ink-2">
            Your {missing.map((item) => item.size).join(' and ')} {missing.length > 1 ? 'are' : 'is'} not on your
            profile yet, so {missing.map((item) => item.garments).join(' and ')} show every size in stock.{' '}
            <Link href="/you/sizes" className="font-medium text-accent underline-offset-4 hover:underline">
              Add {missing.length > 1 ? 'them' : 'it'}
            </Link>
          </p>
        ) : null}

        {feed.groups.map((group) => (
          <SlotFinds key={group.slot.id} group={group} colourName={name} />
        ))}

        {finds > 0 && feed.quietSlots > 0 && feed.run.status === 'succeeded' ? (
          <p className="mt-10 text-[0.9375rem] text-ink-3">
            {feed.quietSlots} more {feed.quietSlots === 1 ? 'slot' : 'slots'} had nothing good enough to show.
          </p>
        ) : null}
      </section>

      {everything}
    </>
  )
}

/** One slot's finds: the slot as a row that opens it, then its cards to swipe through. */
function SlotFinds({ group, colourName }: { group: FeedGroup; colourName: (hex: string) => string | null }) {
  const { slot, cards } = group
  const headingId = `slot-${slot.id}`
  return (
    <section aria-labelledby={headingId} className="mt-12">
      <Link href={`/blueprint/${slot.id}`} className="pressable group flex items-center gap-3">
        <SlotSwatches colours={slot.colours} names={slot.colours.map(colourName)} className="h-10 w-10" />
        <span className="min-w-0">
          <h2 id={headingId} className="title text-[1.125rem]">
            {slot.name}
          </h2>
          <span className="caption block">
            {PRIORITY_LABELS[slot.priority].title}
            {slot.status === 'candidate' ? ', with a saved find' : ''}
          </span>
        </span>
      </Link>
      {/* A swipe row on the phone; on a laptop, where a mouse scrolls sideways badly, a grid. */}
      <div className="bleed scroller mt-4 gap-3 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-x-6 lg:gap-y-10 lg:overflow-visible lg:px-0 lg:pb-0 xl:grid-cols-4">
        {cards.map((find) => (
          <FindCard key={find.product_id} find={find} slotName={slot.name} />
        ))}
      </div>
    </section>
  )
}

/** "Last night's finds" for the nightly run, otherwise the day it ran. */
function heading(run: Run, finds: number, now = new Date()): string {
  if (run.status === 'running') return finds > 0 ? 'Finds so far.' : 'Still judging.'
  const finished = run.finished_at ?? run.started_at
  const zone = 'Pacific/Auckland'
  const dayOf = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: zone })
  const hour = Number(finished.toLocaleString('en-NZ', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }))
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000)
  const lastNight =
    (dayOf(finished) === dayOf(now) && hour < 8) || (dayOf(finished) === dayOf(yesterday) && hour >= 20)
  const when = lastNight
    ? 'last night'
    : dayOf(finished) === dayOf(now)
      ? 'today'
      : `on ${finished.toLocaleDateString('en-NZ', { weekday: 'long', timeZone: zone })}`
  if (finds === 0) return run.stats.scoring ? `Nothing cleared the bar ${when}.` : `The run ${when} stopped before judging.`
  const count = `${finds} ${finds === 1 ? 'find' : 'finds'}`
  return lastNight ? `${count} last night.` : when === 'today' ? `${count} today.` : `${count} from ${when.slice(3)}.`
}

function runLine(run: Run, finds: number, slots: number, capped: boolean): string {
  const zone = { timeZone: 'Pacific/Auckland' } as const
  const at = run.finished_at ?? run.started_at
  const weekday = at.toLocaleDateString('en-NZ', { weekday: 'long', ...zone })
  const time = at.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', ...zone })
  if (run.status === 'running') {
    const shown = capped ? `, the best ${CARDS_PER_SLOT} of each shown` : ''
    const found = finds > 0 ? ` ${finds} ${finds === 1 ? 'find' : 'finds'} for ${slots} of your slots so far${shown}.` : ''
    return `Started on ${weekday} at ${time} and still judging; more arrive as it goes.${found}`
  }
  const ingested = run.stats.ingested as { products?: number; retailers?: unknown[] } | undefined
  const read = ingested?.retailers
    ? `Read ${ingested.retailers.length} shops, ${(ingested.products ?? 0).toLocaleString('en-NZ')} pieces, on ${weekday} at ${time}.`
    : `Checked on ${weekday} at ${time}.`
  const scoring = run.stats.scoring as { needed?: number; scored?: number; skipped_for_budget?: number } | null | undefined
  const budget = run.stats.budget as { max_usd?: number; limited_by?: string } | undefined
  const counted =
    scoring && typeof scoring.needed === 'number' && typeof scoring.scored === 'number' && scoring.scored < scoring.needed
      ? `${scoring.scored.toLocaleString('en-NZ')} of ${scoring.needed.toLocaleString('en-NZ')} pieces`
      : null
  const limit = budget?.limited_by === 'month' ? 'the month’s limit' : `the ${usdText(budget?.max_usd ?? 0)} limit`
  const partial = !scoring
    ? ' This run did not judge anything new; what is waiting is judged on the next run.'
    : counted && (scoring.skipped_for_budget ?? 0) > 0
      ? ` Judging stopped at ${limit} after ${counted}; the rest are judged on the next run.`
      : counted
        ? ` Judging stopped after ${counted}; the rest are judged on the next run.`
        : ''
  if (finds === 0) return `${read} None were close enough to your slots to show.${partial}`
  const order = capped ? `, the best ${CARDS_PER_SLOT} of each shown` : ', best first'
  return `${read} For ${slots} of your slots${order}.${partial}`
}
