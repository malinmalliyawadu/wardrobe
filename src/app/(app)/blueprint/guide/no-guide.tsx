import Link from 'next/link'

export function NoGuide() {
  return (
    <p className="mt-8 text-ink-2">
      There is no guide to edit yet.{' '}
      <Link href="/blueprint/guide" className="text-accent underline decoration-accent/40 underline-offset-4">
        Draft it first
      </Link>
      .
    </p>
  )
}
