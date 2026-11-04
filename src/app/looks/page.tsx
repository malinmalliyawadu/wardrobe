import type { Metadata } from 'next'

import { ButtonLink } from '@/components/button-link'

import { LooksTabs } from './tabs'

export const metadata: Metadata = { title: 'Looks' }

export default function LooksPage() {
  return (
    <section>
      <LooksTabs current="looks" />
      <p className="mt-5 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Outfits from what you own, put together against your palette, your proportions and your week.
      </p>
      <div className="mt-10 border-t border-line pt-8">
        <p className="max-w-[42ch] text-ink-2">Looks are made from your pieces. Add what you own first.</p>
        <ButtonLink href="/looks/pieces" className="mt-6">
          Your pieces
        </ButtonLink>
      </div>
    </section>
  )
}
