import type { CSSProperties } from 'react'

import { ButtonLink } from '@/components/button-link'
import { SwatchFan } from '@/components/swatch-fan'

export default function TodayPage() {
  return (
    <section className="pt-8 lg:pt-6">
      <SwatchFan />
      <div className="reveal mt-12" style={{ '--d': '340ms' } as CSSProperties}>
        <h1 className="font-display text-[2.75rem] leading-[1.02] tracking-[-0.015em] sm:text-[3.5rem]">
          Your palette is blank.
        </h1>
        <p className="mt-5 max-w-[36ch] text-[1.0625rem] leading-relaxed text-ink-2">
          Tell Wardrobe your colouring, proportions and sizes. It drafts what you should own,
          then looks for it every night in Wellington shops and online.
        </p>
        <ButtonLink href="/you" className="mt-8">
          Start your profile
        </ButtonLink>
      </div>
    </section>
  )
}
