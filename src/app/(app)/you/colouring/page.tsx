import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { parseStoredAnalysis } from '@/lib/analysis'
import { getProfile } from '@/lib/profile'

import { ColouringForm } from './form'

export const metadata: Metadata = { title: 'Colouring and proportions' }

export default function ColouringPage() {
  return (
    <section>
      <BackLink />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Colouring and proportions
      </h1>
      <Suspense fallback={<p className="mt-6 text-ink-3">Loading</p>}>
        <Content />
      </Suspense>
    </section>
  )
}

async function Content() {
  await connection()
  const profile = await getProfile()
  const analysis = parseStoredAnalysis(profile.analysis)

  if (!analysis) {
    return (
      <>
        <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
          Claude reads undertone, depth, contrast, season and proportions from your photos.
          You confirm or correct each one.
        </p>
        <p className="mt-10 border-t border-line pt-6 text-ink-3">
          No read yet.{' '}
          <Link href="/you/photos" className="text-brass underline decoration-brass/40 underline-offset-4">
            Add photos
          </Link>{' '}
          and ask for one.
        </p>
      </>
    )
  }

  return (
    <>
      <blockquote className="mt-6 max-w-[42ch] font-display text-[1.375rem] leading-snug text-ink">
        {analysis.summary}
      </blockquote>
      {analysis.photo_notes.length > 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">
          <p className="font-medium text-ink">About the photos</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {analysis.photo_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-6 text-sm text-ink-3">
        Each line is Claude&rsquo;s pick with how sure it was. Change anything you know to be
        wrong, then confirm.
        {profile.confirmed_at ? ' Confirming again replaces the earlier confirmation.' : ''}
      </p>
      <ColouringForm analysis={analysis} />
    </>
  )
}
