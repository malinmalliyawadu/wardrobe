import Link from 'next/link'

export function NoGuide() {
  return (
    <p className="mt-10 border-t border-line pt-6 text-ink-2">
      There is no guide to edit yet.{' '}
      <Link href="/blueprint/guide" className="text-brass underline decoration-brass/40 underline-offset-4">
        Draft it first
      </Link>
      .
    </p>
  )
}
