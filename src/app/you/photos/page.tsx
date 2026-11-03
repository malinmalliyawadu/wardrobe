import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { listPhotos } from '@/lib/photos'
import { getProfile } from '@/lib/profile'

import { AnalyseButton, DeleteAllButton, PhotoSection } from './uploader'

export const metadata: Metadata = { title: 'Photos' }

export default function PhotosPage() {
  return (
    <section>
      <BackLink />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Photos
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Daylight, no filter, hair as you usually wear it. They stay on this server, go to
        Claude once for the read, and can be deleted afterwards without losing the profile.
      </p>
      <Suspense fallback={<p className="mt-10 text-ink-3">Loading photos</p>}>
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
      <PhotoSection
        kind="face"
        title="Face"
        hint="Facing a window, no makeup or filter. One or two."
        photos={faces}
        max={2}
      />
      <PhotoSection
        kind="full_body"
        title="Full length"
        hint="Fitted clothes, plain background, phone at chest height. One or two."
        photos={bodies}
        max={2}
      />
      <PhotoSection
        kind="reference"
        title="References"
        hint="Looks you like. Optional, up to six. Not used for the colour read."
        photos={references}
        max={6}
      />

      <div className="mt-12 border-t border-line pt-8">
        <AnalyseButton hasFace={faces.length > 0} again={profile.analysed_at !== null} />
        <p className="mt-3 max-w-[40ch] text-sm text-ink-3">
          {faces.length === 0
            ? 'Add a face photo to enable the read.'
            : bodies.length === 0
              ? 'A full-length photo improves the proportion read.'
              : 'Takes about a minute. Face and full-length photos are sent; references are not.'}
        </p>
      </div>

      {photos.length > 0 ? (
        <div className="mt-12">
          <DeleteAllButton count={photos.length} />
          <p className="mt-3 text-sm text-ink-3">Hold to delete. The read you confirmed is kept.</p>
        </div>
      ) : null}
    </>
  )
}
