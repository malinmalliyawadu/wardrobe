import { connection } from 'next/server'
import { Suspense, type ReactNode } from 'react'

import { BackLink } from './back-link'
import { FormSkeleton } from './skeleton.tsx'

/**
 * The frame for a sub-page that edits one thing: the way back, the name,
 * one line only where the form needs it, then the form streamed in with
 * the row it edits.
 */
export function SubPage({
  title,
  intro,
  back,
  children,
}: {
  title: string
  intro?: string
  back?: { href: '/you' | '/blueprint' | '/blueprint/guide' | '/wardrobe' | '/finds'; label: string }
  children: ReactNode
}) {
  return (
    <section>
      <BackLink href={back?.href} label={back?.label} />
      <h1 className="headline mt-3 text-[2rem] sm:text-[2.5rem]">{title}</h1>
      {intro ? <p className="prose mt-3 max-w-[44ch] text-[0.9375rem] leading-normal text-ink-2">{intro}</p> : null}
      <Suspense fallback={<FormSkeleton />}>{children}</Suspense>
    </section>
  )
}

/** Marks the subtree as request-time so the form's defaults come from the live row. */
export async function Live({ children }: { children: ReactNode }) {
  await connection()
  return children
}
