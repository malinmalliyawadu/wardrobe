import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense, type CSSProperties } from 'react'

import { HubRow } from '@/components/hub-row'
import { Refresh } from '@/components/refresh'
import { SectionHead } from '@/components/section'
import { day, lookWearLine } from '@/lib/format'
import { OCCASION_LABELS, gymReadiness, readiness, todayNz } from '@/lib/looks'
import { getOutfit, listOutfits, outfitTotals, type OutfitSource, type OutfitSummary, type OutfitView } from '@/lib/outfit'
import { listPieces } from '@/lib/pieces'
import { getGuide } from '@/lib/style-guide'

import { LookCard } from '../look-card'
import { OutfitSkeleton } from '../skeletons'
import { WardrobeHead } from '../tabs'

import { AskForm } from './ask-form'
import { OutfitSpread } from './outfit-spread'

export const metadata: Metadata = { title: 'Outfit' }

/**
 * One outfit from scratch, for whatever he says it is for, made from his
 * wardrobe, the shops, both, or anything (the ideal pieces, described). The page opens on the newest (or the earlier
 * one the URL names), then the ask, then the earlier ones.
 */
export default function OutfitPage({ searchParams }: PageProps<'/wardrobe/outfit'>) {
  return (
    <section>
      <Suspense fallback={<OutfitSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </section>
  )
}

const FROM: Record<OutfitSource, string> = {
  wardrobe: 'From your wardrobe',
  shops: 'From the shops',
  both: 'From your wardrobe and the shops',
  anywhere: 'From anything',
}

function forLine(outfit: Pick<OutfitSummary, 'brief'>): string {
  return outfit.brief ? `For "${outfit.brief}"` : 'For an ordinary day'
}

async function Content({ searchParams }: Pick<PageProps<'/wardrobe/outfit'>, 'searchParams'>) {
  await connection()
  const asked = (await searchParams).show
  const show = Number(Array.isArray(asked) ? asked[0] : asked)
  const [guide, pieces, named, all, totals] = await Promise.all([
    getGuide(),
    listPieces(),
    Number.isInteger(show) && show > 0 ? getOutfit(show) : null,
    listOutfits(9),
    outfitTotals(),
  ])

  if (!guide) {
    return (
      <>
        <WardrobeHead current="outfit" line="No style guide yet" />
        <p className="mt-10 max-w-[42ch] text-ink-2">
          An outfit is put together against your style guide.{' '}
          <Link href="/blueprint" className="text-accent underline decoration-accent/40 underline-offset-4">
            Draft it
          </Link>{' '}
          first.
        </p>
      </>
    )
  }

  const outfit = named ?? (await getOutfit(null))
  const making = outfit?.status === 'making'
  const earlier = all.filter((other) => other.id !== outfit?.id)
  const owned = readiness(pieces).ready || gymReadiness(pieces).ready
  const sources: OutfitSource[] = owned ? ['wardrobe', 'shops', 'both', 'anywhere'] : ['shops', 'both', 'anywhere']
  const line = making
    ? 'Putting an outfit together'
    : totals.count === 0
      ? 'One outfit for anything, from your wardrobe, the shops, both, or neither'
      : `${totals.count} ${totals.count === 1 ? 'outfit' : 'outfits'} asked for so far`

  return (
    <>
      <WardrobeHead current="outfit" line={line} />

      {outfit ? (
        <section aria-labelledby="outfit" className="mt-12">
          <SectionHead id="outfit" title={forLine(outfit)} aside={`${FROM[outfit.source]}, ${day(outfit.started_at)}`} />
          <div className="mt-6">
            <Shown outfit={outfit} />
          </div>
        </section>
      ) : null}

      {making ? null : (
        <section aria-labelledby="ask" className={outfit ? 'mt-16' : 'mt-12'}>
          <SectionHead
            id="ask"
            title={outfit ? 'Another outfit' : 'Ask for an outfit'}
            aside={totals.count > 0 ? `${totals.count} so far, US$${totals.usd.toFixed(2)}` : undefined}
          />
          <p className="prose mt-3 max-w-[48ch] text-[0.9375rem] leading-normal text-ink-2">
            {owned
              ? 'Say what it is for and what to make it from. From the shops it is a whole outfit to buy in your size; from both, what you own with only what it lacks; from anything, the ideal pieces described and a picture of you in them, tied to no shop.'
              : 'Say what it is for. Your wardrobe cannot dress you yet, so it comes from the shops in your size, with what you own where it fits, or from anything: the ideal pieces described and a picture of you in them, tied to no shop.'}
          </p>
          <div className="mt-5">
            <AskForm sources={sources} initial={outfit && sources.includes(outfit.source) ? outfit.source : sources[0]!} />
          </div>
        </section>
      )}

      {earlier.length > 0 ? (
        <section aria-labelledby="earlier" className="mt-16">
          <SectionHead id="earlier" title="Earlier" aside={earlier.length} />
          <ul className="mt-2 max-w-3xl divide-y divide-line">
            {earlier.map((other) => (
              <HubRow
                key={other.id}
                href={{ pathname: '/wardrobe/outfit', query: { show: other.id } }}
                title={other.title ?? (other.status === 'making' ? 'In the making' : 'Did not finish')}
                summary={`${forLine(other)}. ${FROM[other.source]}, ${day(other.started_at)}`}
                filled={other.status === 'ready'}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

/** The outfit the page is on: in the making, failed with why, a look of his own pieces, or a spread with the shops' pieces or described ones in it. */
function Shown({ outfit }: { outfit: OutfitView }) {
  if (outfit.status === 'making') {
    return (
      <>
        <Making outfit={outfit} />
        <Refresh />
      </>
    )
  }
  if (outfit.status === 'failed') {
    return (
      <p role="alert" className="max-w-[44ch] text-ink-2">
        {outfit.error ?? 'It did not finish.'}
      </p>
    )
  }
  if (outfit.dismissed) return <p className="max-w-[44ch] text-ink-2">You dismissed this one.</p>
  if (outfit.look) {
    return (
      <LookCard
        key={outfit.look.id}
        look={outfit.look}
        today={todayNz()}
        occasion={OCCASION_LABELS[outfit.look.occasion]}
        wornLine={lookWearLine(outfit.look)}
        wide
      />
    )
  }
  if (outfit.parts.length === 0) return <p className="max-w-[44ch] text-ink-2">Its pieces are no longer in your wardrobe or the shops.</p>
  // An outfit from anything gets its picture of him right after it is made: keep reading until it is there.
  const drawing =
    outfit.source === 'anywhere' &&
    (outfit.on_me ? outfit.on_me.status === 'making' : outfit.just_made)
  return (
    <>
      <OutfitSpread key={outfit.id} outfit={outfit} occasion={outfit.occasion ? OCCASION_LABELS[outfit.occasion] : 'Outfit'} drawing={drawing} />
      {drawing ? <Refresh /> : null}
    </>
  )
}

/** Where it is, in words, with a hairline that fills by stage. The line moves by transform only. */
function Making({ outfit }: { outfit: OutfitView }) {
  const text =
    outfit.stage === 'planning'
      ? 'Reading what it is for, and what to look for in the shops.'
      : outfit.stage === 'looking'
        ? 'Looking through the shops for each piece in your size.'
        : outfit.source === 'wardrobe'
          ? 'Opus is putting the outfit together from your pieces.'
          : outfit.source === 'anywhere'
            ? 'Opus is putting the outfit together, piece by piece.'
            : 'Opus is putting the outfit together from the closest of each.'
  const share = outfit.stage === 'planning' ? 0.1 : outfit.stage === 'looking' ? 0.35 : 0.7
  return (
    <div aria-live="polite">
      <p className="text-[0.9375rem] text-ink-2">{text}</p>
      <div className="mt-4 h-px w-full overflow-hidden bg-line">
        <div className="progress-line h-px w-full origin-left bg-accent" style={{ '--share': share } as CSSProperties} />
      </div>
      <p className="mt-3 text-sm text-ink-3">A minute or two. You can leave; it keeps going.</p>
    </div>
  )
}
