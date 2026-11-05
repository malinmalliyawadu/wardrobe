import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

import { ChevronIcon } from './icons.tsx'

type Props = {
  href: ComponentProps<typeof Link>['href']
  title: string
  summary: string
  /** True when the summary is a real value rather than "Not set". */
  filled: boolean
  aside?: ReactNode
}

/** A row in a list that leads somewhere: a name, one line of what is there, a chevron. */
export function HubRow({ href, title, summary, filled, aside }: Props) {
  return (
    <li>
      <Link href={href} className="pressable -mx-2 flex min-h-16 items-center gap-4 rounded-[var(--radius-control)] px-2 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className={`text-sm ${filled ? 'text-ink-2' : 'text-ink-3'}`}>{summary}</p>
        </div>
        {aside}
        <ChevronIcon className="shrink-0 text-ink-3" />
      </Link>
    </li>
  )
}
