import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Blueprint' }

export default function BlueprintPage() {
  return (
    <section>
      <h1 className="font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        Blueprint
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Thirty to forty slots, each a specific item with a why, a priority and a budget. The
        nightly finder matches real products against these.
      </p>
      <p className="mt-10 border-t border-line pt-6 text-ink-3">
        No slots yet. They are drafted from your style guide, so{' '}
        <Link href="/you" className="text-brass underline decoration-brass/40 underline-offset-4">
          start your profile
        </Link>{' '}
        first.
      </p>
    </section>
  )
}
