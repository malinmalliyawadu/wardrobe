import Link from 'next/link'

export function BackLink({ href = '/you', label = 'You' }: { href?: '/you' | '/'; label?: string }) {
  return (
    <Link
      href={href}
      className="pressable -ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-ink-2 transition-colors duration-150 ease-out"
    >
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
      >
        <path d="m15 5-7 7 7 7" />
      </svg>
      {label}
    </Link>
  )
}
