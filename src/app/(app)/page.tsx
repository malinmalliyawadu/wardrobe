import { connection } from 'next/server'
import { Suspense, type CSSProperties } from 'react'

import { ButtonLink } from '@/components/button-link'
import { Feed } from '@/components/feed/feed'
import { FeedSkeleton } from '@/components/feed/feed-skeleton'
import { SwatchFan } from '@/components/swatch-fan'
import { listSlots, type Slot } from '@/lib/blueprint'
import { getProfile } from '@/lib/profile'
import { SEASON_INFO, seasonName } from '@/lib/seasons'
import { getGuide } from '@/lib/style-guide'

export default function TodayPage() {
  return (
    <section className="pt-8 lg:pt-6">
      {/* The hero's own height (fan, headline, line, button: about 470px at
          either width), held empty so the feed below does not jump when it lands. */}
      <Suspense fallback={<div className="h-[29.5rem]" aria-hidden />}>
        <Hero />
      </Suspense>
      <Suspense fallback={<FeedSkeleton />}>
        <Feed />
      </Suspense>
    </section>
  )
}

/**
 * Streams in after the static shell. The fan and the headline are one
 * sequence, so nothing animates in the fallback; the whole hero arrives at
 * once and plays once.
 */
async function Hero() {
  await connection()
  const [profile, guide, slots] = await Promise.all([getProfile(), getGuide(), listSlots()])
  const season = profile.confirmed_at ? profile.season : null

  if (season) {
    const info = SEASON_INFO[season]
    // Once a guide exists the fan wears its best colours, which are Malin's
    // own; until then, the season's representative ones.
    const colours = guide ? guide.palette.best.map((colour) => colour.hex) : info.swatches
    const next = nextStep(guide !== null, slots)
    return (
      <>
        <SwatchFan colours={colours} label={guide ? 'Your best colours' : `${seasonName(season)} palette`} />
        <div className="reveal mt-12" style={{ '--d': '340ms' } as CSSProperties}>
          <h1 className="font-display text-[2.75rem] leading-[1.02] tracking-[-0.015em] sm:text-[3.5rem]">
            Your palette is {seasonName(season).toLowerCase()}.
          </h1>
          <p className="mt-5 max-w-[36ch] text-[1.0625rem] leading-relaxed text-ink-2">
            {info.traits} {next.line}
          </p>
          <ButtonLink href={next.href} className="mt-8">
            {next.button}
          </ButtonLink>
        </div>
      </>
    )
  }

  return (
    <>
      <SwatchFan />
      <div className="reveal mt-12" style={{ '--d': '340ms' } as CSSProperties}>
        <h1 className="font-display text-[2.75rem] leading-[1.02] tracking-[-0.015em] sm:text-[3.5rem]">
          Your palette is blank.
        </h1>
        <p className="mt-5 max-w-[36ch] text-[1.0625rem] leading-relaxed text-ink-2">
          Tell Wardrobe your colouring, proportions and sizes. It drafts what you should own,
          then looks for it every night in Wellington shops and online.
        </p>
        <ButtonLink href={profile.analysed_at ? '/you/colouring' : '/you'} className="mt-8">
          {profile.analysed_at ? 'Confirm your read' : 'Start your profile'}
        </ButtonLink>
      </div>
    </>
  )
}

/** Where Malin is in M2, as one line and one button. */
function nextStep(hasGuide: boolean, slots: Slot[]): { line: string; href: string; button: string } {
  if (!hasGuide) {
    return {
      line: 'Next comes your style guide, then the blueprint: what to own, drafted from this read.',
      href: '/blueprint',
      button: 'Draft your style guide',
    }
  }
  if (slots.length === 0) {
    return {
      line: 'Your style guide is ready. Next, the blueprint: what to own, in the order to buy it.',
      href: '/blueprint',
      button: 'Draft the blueprint',
    }
  }
  const first = slots.filter((slot) => slot.priority === 1 && slot.status === 'wanted').length
  return {
    line: first
      ? `Your blueprint has ${slots.length} slots, ${first} of them to buy first.`
      : `Your blueprint has ${slots.length} slots.`,
    href: '/blueprint',
    button: 'Open the blueprint',
  }
}
