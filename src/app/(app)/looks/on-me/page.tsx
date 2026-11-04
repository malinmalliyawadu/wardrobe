import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/button-link'
import { listOnMe, type OnMeImage } from '@/lib/on-me'

import { OnMeSkeleton } from '../skeletons'
import { LooksTabs } from '../tabs'
import { Making } from './making'
import { SourceStrip, eyebrow } from './sources'

export const metadata: Metadata = { title: 'On me' }

export default function OnMePage() {
  return (
    <section>
      <LooksTabs current="on-me" />
      <p className="mt-5 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Every picture of you made so far, each beside what it was made from. Choose pieces you own or saved to see
        them on you together.
      </p>
      <Suspense fallback={<OnMeSkeleton />}>
        <Content />
      </Suspense>
    </section>
  )
}

async function Content() {
  await connection()
  const images = await listOnMe()

  if (images.length === 0) {
    return (
      <div className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-[1.625rem] leading-tight">Nothing yet</h2>
        <p className="mt-3 max-w-[42ch] text-ink-2">
          Tap “See it on me” on a find or a look, or choose a few pieces here. Each picture is made by OpenAI from
          your full-length photo and lands here.
        </p>
        <ButtonLink href="/looks/on-me/new" className="mt-6">
          Choose pieces
        </ButtonLink>
      </div>
    )
  }

  const ready = images.filter((image) => image.status === 'ready')
  const usd = ready.reduce((sum, image) => sum + (image.usd ?? 0), 0)
  return (
    <>
      <div className="mt-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <p className="max-w-[24ch] font-display text-[1.375rem] leading-snug">
          {ready.length} {ready.length === 1 ? 'picture' : 'pictures'}
          {usd > 0 ? <span className="tabular-nums">, US${usd.toFixed(2)} in all</span> : null}.
        </p>
        <ButtonLink href="/looks/on-me/new">Choose pieces</ButtonLink>
      </div>

      <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
        {images.map((image) => (
          <li key={image.id}>
            <Tile image={image} />
          </li>
        ))}
      </ul>
    </>
  )
}

function Tile({ image }: { image: OnMeImage }) {
  return (
    <Link href={`/looks/on-me/${image.id}`} className="pressable block rounded-xl">
      {image.status === 'making' ? (
        <Making id={image.id} className="aspect-[3/4] rounded-xl" />
      ) : (
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it */}
          <img
            src={`/photos/try-ons/${image.id}`}
            alt={`You, ${image.subject.title}`}
            width={image.width ?? undefined}
            height={image.height ?? undefined}
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        </div>
      )}
      <p className="mt-2.5 truncate text-[0.75rem] font-medium tracking-[0.02em] text-ink-3 uppercase">{eyebrow(image.subject)}</p>
      <p className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium">{image.subject.title}</p>
      <div className="mt-2">
        <SourceStrip sources={image.sources} />
      </div>
    </Link>
  )
}
