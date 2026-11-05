import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/button-link'
import { listOnMe, type OnMeImage } from '@/lib/on-me'

import { OnMeSkeleton } from '../skeletons'
import { WardrobeHead } from '../tabs'
import { Making } from './making'
import { SourceStrip, eyebrow } from './sources'

export const metadata: Metadata = { title: 'On me' }

export default function OnMePage() {
  return (
    <section>
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
      <>
        <WardrobeHead current="on-me" line="No pictures yet" />
        <p className="mt-10 max-w-[42ch] text-ink-2">
          Tap “See it on me” on a find or a look, or choose a few pieces here. Each picture is made by OpenAI from
          your full-length photo and lands here.
        </p>
        <ButtonLink href="/wardrobe/on-me/new" className="mt-5">
          Choose pieces
        </ButtonLink>
      </>
    )
  }

  const ready = images.filter((image) => image.status === 'ready')
  const usd = ready.reduce((sum, image) => sum + (image.usd ?? 0), 0)
  const count = `${ready.length} ${ready.length === 1 ? 'picture' : 'pictures'}`
  return (
    <>
      <WardrobeHead
        current="on-me"
        line={
          usd > 0 ? (
            <>
              {count}, <span className="tabular-nums">US${usd.toFixed(2)}</span> in all
            </>
          ) : (
            count
          )
        }
        aside={
          <ButtonLink href="/wardrobe/on-me/new" size="small">
            Choose pieces
          </ButtonLink>
        }
      />

      <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
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
    <Link href={`/wardrobe/on-me/${image.id}`} className="pressable block rounded-[var(--radius-tile)]">
      {image.status === 'making' ? (
        <Making id={image.id} className="aspect-[3/4] rounded-[var(--radius-tile)]" />
      ) : (
        <div className="relative aspect-[3/4] overflow-hidden rounded-[var(--radius-tile)] bg-surface">
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
      <p className="caption mt-2.5 truncate">{eyebrow(image.subject)}</p>
      <p className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium">{image.subject.title}</p>
      <div className="mt-2">
        <SourceStrip sources={image.sources} />
      </div>
    </Link>
  )
}
