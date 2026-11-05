import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { Bone, Skeleton, TextBone } from '@/components/skeleton'
import { listPhotos } from '@/lib/photos'
import { getProfile } from '@/lib/profile'

import { AnalyseButton, DeleteAllButton, PhotoSection } from './uploader'

export const metadata: Metadata = { title: 'Photos' }

export default function PhotosPage() {
  return (
    <section>
      <BackLink />
      <h1 className="headline mt-3 text-[2rem] sm:text-[2.5rem]">Photos</h1>
      <p className="prose mt-3 max-w-[44ch] text-[0.9375rem] leading-normal text-ink-2">
        Daylight, no filter, hair as you wear it. They stay here and go to Claude once for the read; a full-length one
        goes to OpenAI only when you ask to see a find on you.
      </p>
      <Suspense fallback={<PhotosSkeleton />}>
        <Sections />
      </Suspense>
    </section>
  )
}

async function Sections() {
  await connection()
  const [photos, profile] = await Promise.all([listPhotos(), getProfile()])
  const faces = photos.filter((p) => p.kind === 'face')
  const bodies = photos.filter((p) => p.kind === 'full_body')
  const references = photos.filter((p) => p.kind === 'reference')

  return (
    <>
      <PhotoSection kind="face" title="Face" hint="Facing a window, no makeup or filter. One or two." photos={faces} max={2} />
      <PhotoSection
        kind="full_body"
        title="Full length"
        hint="Fitted clothes, plain background, phone at chest height. The newest is the one finds are tried on."
        photos={bodies}
        max={2}
      />
      <PhotoSection
        kind="reference"
        title="References"
        hint="Looks you like. Up to six; not used for the colour read."
        photos={references}
        max={6}
      />

      <div className="mt-12">
        <AnalyseButton hasFace={faces.length > 0} again={profile.analysed_at !== null} />
        <p className="mt-3 max-w-[40ch] text-sm text-ink-3">
          {faces.length === 0
            ? 'Add a face photo to enable the read.'
            : bodies.length === 0
              ? 'A full-length photo improves the proportion read.'
              : profile.height_cm === null
                ? 'Add your height under Height and sizes first; the proportion read is a guess without it.'
                : 'Takes about a minute. Face and full-length photos are sent; references are not.'}
        </p>
      </div>

      {photos.length > 0 ? (
        <div className="mt-10">
          <DeleteAllButton count={photos.length} />
          <p className="mt-3 max-w-[44ch] text-sm text-ink-3">
            Hold to delete. Pictures of finds on you go too; the read you confirmed is kept. OpenAI deletes its own
            copies of try-ons within 30 days.
          </p>
        </div>
      ) : null}
    </>
  )
}

/** The three sections: a caption with its count, a hint, and a row of portrait tiles. */
function PhotosSkeleton() {
  return (
    <Skeleton label="Loading your photos">
      {[2, 2, 3].map((tiles, section) => (
        <div key={section} className={section === 0 ? 'mt-10' : 'mt-12'}>
          <div className="flex items-baseline justify-between">
            <TextBone className="w-16" size="text-[0.8125rem]" />
            <TextBone className="w-8" size="text-[0.8125rem]" />
          </div>
          <TextBone className="w-64 max-w-full" size="text-sm" />
          <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-5">
            {Array.from({ length: tiles }, (_, index) => (
              <Bone key={index} className="aspect-[3/4] w-full" />
            ))}
          </div>
        </div>
      ))}
    </Skeleton>
  )
}
