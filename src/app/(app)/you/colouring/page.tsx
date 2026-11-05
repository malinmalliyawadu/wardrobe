import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { SectionHead } from '@/components/section'
import { FormSkeleton } from '@/components/skeleton'
import { parseStoredAnalysis } from '@/lib/analysis'
import { getProfile } from '@/lib/profile'

import { ColouringForm } from './form'

export const metadata: Metadata = { title: 'Colouring and proportions' }

export default function ColouringPage() {
  return (
    <section>
      <BackLink />
      <h1 className="headline mt-3 text-[2rem] sm:text-[2.5rem]">Colouring and proportions</h1>
      <Suspense fallback={<FormSkeleton fields={5} />}>
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
      <p className="mt-8 max-w-[44ch] text-ink-2">
        No read yet.{' '}
        <Link href="/you/photos" className="text-accent underline decoration-accent/40 underline-offset-4">
          Add photos
        </Link>{' '}
        and ask for one.
      </p>
    )
  }

  return (
    <>
      <p className="prose mt-8 max-w-[44ch] text-[1.125rem] leading-normal text-ink">{analysis.summary}</p>
      {analysis.photo_notes.length > 0 ? (
        <section className="mt-8">
          <SectionHead title="About the photos" as="p" />
          <ul className="mt-2 space-y-1 border-l-2 border-line pl-3 text-sm text-ink-2">
            {analysis.photo_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="mt-8 max-w-[44ch] text-sm text-ink-3">
        Each line is Claude&rsquo;s pick and how sure it was. Change anything you know to be wrong, then confirm.
        {profile.confirmed_at ? ' Confirming again replaces the earlier confirmation.' : ''}
      </p>
      <ColouringForm analysis={analysis} />
    </>
  )
}
