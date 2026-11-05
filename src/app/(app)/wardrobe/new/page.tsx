import type { Metadata } from 'next'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { Live } from '@/components/sub-page'
import { fillableSlots } from '@/lib/pieces'
import { getGuide } from '@/lib/style-guide'

import { AddPieceSkeleton } from '../skeletons'
import { paletteSwatches } from '../piece-values'
import { AddPiece } from '../add-piece'

export const metadata: Metadata = { title: 'Add a piece' }

export default function NewPiecePage({ searchParams }: PageProps<'/wardrobe/new'>) {
  return (
    <section>
      <BackLink href="/wardrobe" label="Wardrobe" />
      <h1 className="headline mt-3 text-[2rem] sm:text-[2.5rem]">Add a piece</h1>
      <Suspense fallback={<AddPieceSkeleton />}>
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
async function Content({ searchParams }: Pick<PageProps<'/wardrobe/new'>, 'searchParams'>) {
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
