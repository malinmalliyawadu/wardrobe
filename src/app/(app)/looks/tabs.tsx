import Link from 'next/link'

/**
 * The tab's three pages as its title: the open one in ink over a brass rule,
 * the others quiet beside it. Switching is a plain navigation, so nothing
 * moves. Three display-size words only just fit a phone, so the gap is
 * tighter there.
 */
export function LooksTabs({ current }: { current: 'looks' | 'pieces' | 'on-me' }) {
  const items = [
    { key: 'looks', href: '/looks', label: 'Looks' },
    { key: 'pieces', href: '/looks/pieces', label: 'Pieces' },
    { key: 'on-me', href: '/looks/on-me', label: 'On me' },
  ] as const
  return (
    <nav aria-label="Looks, pieces and pictures of you" className="flex items-baseline gap-5 whitespace-nowrap sm:gap-7">
      {items.map((item) =>
        item.key === current ? (
          <h1
            key={item.key}
            className="border-b-2 border-brass pb-1 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]"
          >
            {item.label}
          </h1>
        ) : (
          <Link
            key={item.key}
            href={item.href}
            className="pressable -mx-1 rounded-lg px-1 pb-1 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] text-ink-3 transition-colors duration-150 ease-out sm:text-[2.75rem]"
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  )
}
