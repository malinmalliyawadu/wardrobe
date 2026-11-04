import Link from 'next/link'
import type { ReactNode } from 'react'

type Props = {
  href: '/you/photos' | '/you/colouring' | '/you/sizes' | '/you/life' | '/you/taste' | '/you/budget' | '/you/finder'
  title: string
  summary: string
  /** True when the summary is a real value rather than "Not set". */
  filled: boolean
  aside?: ReactNode
}

export function HubRow({ href, title, summary, filled, aside }: Props) {
  return (
    <li>
      <Link
        href={href}
        className="pressable -mx-2 flex min-h-16 items-center gap-4 rounded-xl px-2 py-3"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className={`text-sm ${filled ? 'text-ink-2' : 'text-ink-3'}`}>{summary}</p>
        </div>
        {aside}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0 text-ink-3"
        >
          <path d="m9 5 7 7-7 7" />
        </svg>
      </Link>
    </li>
  )
}
