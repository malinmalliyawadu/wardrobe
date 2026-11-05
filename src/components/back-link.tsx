import Link from 'next/link'
import type { ComponentProps } from 'react'

import { BackIcon } from './icons.tsx'

type Href = ComponentProps<typeof Link>['href']

/** The small way back at the top of a sub-page, named for where it goes. */
export function BackLink({ href = '/you', label = 'You' }: { href?: Href; label?: string }) {
  return (
    <Link
      href={href}
      className="pressable -ml-2 inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm font-medium text-ink-2"
    >
      <BackIcon />
      {label}
    </Link>
  )
}
