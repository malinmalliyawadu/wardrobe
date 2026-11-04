import { connection } from 'next/server'
import { Suspense, type ReactNode } from 'react'

import { BackLink } from './back-link'
import { FormSkeleton } from './skeleton.tsx'

/**
 * The frame for every profile sub-page: back link, title, one paragraph, then
 * the form streamed in with the profile it edits.
 */
export function SubPage({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  children: ReactNode
}) {
  return (
    <section>
      <BackLink />
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        {title}
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">{intro}</p>
      <Suspense fallback={<FormSkeleton />}>{children}</Suspense>
    </section>
  )
}

/** Marks the subtree as request-time so the form's defaults come from the live row. */
export async function Live({ children }: { children: ReactNode }) {
  await connection()
  return children
}
