import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { ButtonLink } from '@/components/button-link'
import { Live } from '@/components/sub-page'
import { keptOutfits, outfitChoices } from '@/lib/on-me'
import { shelve } from '@/lib/pieces'
import { MAX_OUTFIT_PIECES, fullLengthPhoto } from '@/lib/try-on'

import { ChooseSkeleton } from '../../skeletons'
import { Chooser } from './chooser'

export const metadata: Metadata = { title: 'Choose pieces' }

export default function ChoosePage() {
  return (
    <section>
      <BackLink href="/wardrobe/on-me" label="On me" />
      <h1 className="headline mt-3 text-[2rem] sm:text-[2.5rem]">Choose pieces</h1>
      <p className="prose mt-3 max-w-[44ch] text-[0.9375rem] leading-normal text-ink-2">
        Up to {MAX_OUTFIT_PIECES} pieces, from what you own and what you saved, put on you in one picture. What you
        leave out stays as you are wearing it in your photo.
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
  const [choices, photo, kept] = await Promise.all([outfitChoices(), fullLengthPhoto(), keptOutfits()])

  if (!photo) {
    return (
      <p className="mt-10 max-w-[42ch] text-ink-2">
        A picture is made from your full-length photo.{' '}
        <Link href="/you/photos" className="text-accent underline decoration-accent/40 underline-offset-4">
          Add one
        </Link>{' '}
        first.
      </p>
    )
  }

  if (choices.pieces.length === 0 && choices.finds.length === 0) {
    return (
      <>
        <p className="mt-10 max-w-[42ch] text-ink-2">
          Nothing to choose yet. Add the pieces you own, or save a find, and they show here.
        </p>
        <ButtonLink href="/wardrobe/new" className="mt-5">
          Add a piece
        </ButtonLink>
      </>
    )
  }

  const groups = [
    ...(choices.finds.length > 0 ? [{ title: 'Saved finds', choices: choices.finds }] : []),
    ...shelve(choices.pieces.map((choice) => ({ ...choice, garment_type: choice.garment_type!, worn_for: choice.worn_for ?? 'everyday' }))).map((group) => ({
      title: group.title,
      choices: group.pieces,
    })),
  ]
  return <Chooser groups={groups} max={MAX_OUTFIT_PIECES} kept={kept} />
}
