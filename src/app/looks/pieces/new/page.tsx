import type { Metadata } from 'next'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { Live } from '@/components/sub-page'
import { fillableSlots } from '@/lib/pieces'
import { getGuide } from '@/lib/style-guide'

import { paletteSwatches } from '../piece-values'
import { AddPiece } from './add-piece'

export const metadata: Metadata = { title: 'Add a piece' }

export default function NewPiecePage({ searchParams }: PageProps<'/looks/pieces/new'>) {
  return (
    <section>
      <BackLink href="/looks/pieces" label="Pieces" />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">Add a piece</h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Something you already own. Looks are made from these, so the colour and the cloth matter most.
      </p>
      <Suspense fallback={<p className="mt-8 text-ink-3">Loading</p>}>
        <Live>
          <Content searchParams={searchParams} />
        </Live>
      </Suspense>
    </section>
  )
}

/**
 * After "Save and add another" the page comes back with ?added=, and the
 * form starts fresh for the next piece: a new key drops the last one's read.
 */
async function Content({ searchParams }: Pick<PageProps<'/looks/pieces/new'>, 'searchParams'>) {
  const [guide, slots, { added }] = await Promise.all([getGuide(), fillableSlots(null), searchParams])
  const key = typeof added === 'string' ? added : 'first'
  return (
    <>
      {key !== 'first' ? (
        <p role="status" className="mt-6 text-[0.9375rem] text-ink-2">
          Added to your wardrobe. Next piece.
        </p>
      ) : null}
      <AddPiece key={key} {...paletteSwatches(guide)} slots={slots} />
    </>
  )
}
