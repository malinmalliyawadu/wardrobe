import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { ButtonLink } from '@/components/button-link'
import { Live } from '@/components/sub-page'
import { outfitChoices } from '@/lib/on-me'
import { shelve } from '@/lib/pieces'
import { MAX_OUTFIT_PIECES, fullLengthPhoto } from '@/lib/try-on'

import { ChooseSkeleton } from '../../skeletons'
import { Chooser } from './chooser'

export const metadata: Metadata = { title: 'Choose pieces' }

export default function ChoosePage() {
  return (
    <section>
      <BackLink href="/looks/on-me" label="On me" />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Choose pieces
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Up to {MAX_OUTFIT_PIECES} pieces, from what you own and what you saved, put on you in one picture. What you leave out stays as you are wearing it in your photo.
      </p>
      <Suspense fallback={<ChooseSkeleton />}>
        <Live>
          <Content />
        </Live>
      </Suspense>
    </section>
  )
}

async function Content() {
  const [choices, photo] = await Promise.all([outfitChoices(), fullLengthPhoto()])

  if (!photo) {
    return (
      <p className="mt-10 border-t border-line pt-6 text-ink-2">
        A picture is made from your full-length photo.{' '}
        <Link href="/you/photos" className="text-brass underline decoration-brass/40 underline-offset-4">
          Add one
        </Link>{' '}
        first.
      </p>
    )
  }

  if (choices.pieces.length === 0 && choices.finds.length === 0) {
    return (
      <div className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-[1.625rem] leading-tight">Nothing to choose yet</h2>
        <p className="mt-3 max-w-[42ch] text-ink-2">Add the pieces you own, or save a find on Today, and they show here.</p>
        <ButtonLink href="/looks/pieces/new" className="mt-6">
          Add a piece
        </ButtonLink>
      </div>
    )
  }

  const groups = [
    ...(choices.finds.length > 0 ? [{ title: 'Saved finds', choices: choices.finds }] : []),
    ...shelve(choices.pieces.map((choice) => ({ ...choice, garment_type: choice.garment_type! }))).map((group) => ({
      title: group.title,
      choices: group.pieces,
    })),
  ]
  return <Chooser groups={groups} max={MAX_OUTFIT_PIECES} />
}
