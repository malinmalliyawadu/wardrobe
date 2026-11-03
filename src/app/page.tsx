import { connection } from 'next/server'
import { Suspense, type CSSProperties } from 'react'

import { ButtonLink } from '@/components/button-link'
import { SwatchFan } from '@/components/swatch-fan'
import { getProfile } from '@/lib/profile'
import { SEASON_INFO, seasonName } from '@/lib/seasons'

export default function TodayPage() {
  return (
    <section className="pt-8 lg:pt-6">
      <Suspense fallback={<div className="h-28" aria-hidden />}>
        <Hero />
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
  const profile = await getProfile()
  const season = profile.confirmed_at ? profile.season : null

  if (season) {
    const info = SEASON_INFO[season]
    return (
      <>
        <SwatchFan colours={info.swatches} label={`${seasonName(season)} palette`} />
        <div className="reveal mt-12" style={{ '--d': '340ms' } as CSSProperties}>
          <h1 className="font-display text-[2.75rem] leading-[1.02] tracking-[-0.015em] sm:text-[3.5rem]">
            Your palette is {seasonName(season).toLowerCase()}.
          </h1>
          <p className="mt-5 max-w-[36ch] text-[1.0625rem] leading-relaxed text-ink-2">
            {info.traits} Next comes the blueprint: what to own, drafted from this read.
          </p>
          <ButtonLink href="/you/colouring" className="mt-8">
            See the full read
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
