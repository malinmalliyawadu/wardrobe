'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentType, SVGProps } from 'react'

import { PaletteStrip } from './palette-strip.tsx'
import { BlueprintIcon, FindsIcon, PersonIcon, TodayIcon, WardrobeIcon, WishlistIcon } from './icons.tsx'

type Item = {
  href: '/' | '/finds' | '/wishlist' | '/wardrobe' | '/blueprint' | '/you'
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Pages outside the tab's own path that belong to it. */
  also?: string[]
}

const items: Item[] = [
  { href: '/', label: 'Today', Icon: TodayIcon },
  { href: '/finds', label: 'Finds', Icon: FindsIcon, also: ['/search', '/shops', '/statements'] },
  { href: '/wishlist', label: 'Wishlist', Icon: WishlistIcon },
  { href: '/wardrobe', label: 'Wardrobe', Icon: WardrobeIcon },
  { href: '/blueprint', label: 'Blueprint', Icon: BlueprintIcon },
  { href: '/you', label: 'You', Icon: PersonIcon },
]

export function Wordmark() {
  return (
    <Link href="/" className="display inline-block text-[1.375rem] text-ink">
      Wardrobe
    </Link>
  )
}

/**
 * Six destinations. A translucent tab bar on the phone that the page
 * scrolls under, a rail down the left from the laptop breakpoint up.
 * Switching tabs happens tens of times a day, so the only motion is a 150ms
 * colour change and the press feedback.
 *
 * The pathname is request data on dynamic routes (/blueprint/[id]), so the
 * layout renders Nav inside Suspense with NavShell, the same bar with nothing
 * marked, as the prerendered fallback.
 */
export function Nav({ strip }: { strip?: React.ReactNode }) {
  return <NavBar pathname={usePathname()} strip={strip} />
}

export function NavShell({ strip }: { strip?: React.ReactNode }) {
  return <NavBar pathname={null} strip={strip} />
}

function NavBar({ pathname, strip }: { pathname: string | null; strip?: React.ReactNode }) {
  return (
    <nav
      aria-label="Main"
      className="tabbar fixed inset-x-0 bottom-0 z-20 border-t border-line pb-[env(safe-area-inset-bottom)] lg:sticky lg:top-0 lg:h-dvh lg:border-t-0 lg:border-r lg:px-5 lg:pt-10 lg:pb-8"
    >
      <div className="hidden lg:block">
        <Wordmark />
        <div className="mt-4">{strip ?? <PaletteStrip colours={null} />}</div>
      </div>
      <ul className="mx-auto flex max-w-md items-stretch lg:mt-12 lg:max-w-none lg:flex-col lg:gap-0.5">
        {items.map(({ href, label, Icon, also = [] }) => {
          const active =
            pathname !== null && [href, ...also].some((path) => pathname === path || (path !== '/' && pathname.startsWith(path)))
          return (
            <li key={href} className="min-w-0 flex-1 lg:w-full lg:flex-none">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className="tab pressable flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-2 pt-1.5 pb-1 text-[0.6875rem] font-medium lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-[var(--radius-control)] lg:px-3 lg:py-0 lg:text-[0.9375rem]"
              >
                <Icon className="size-6 lg:size-5" />
                <span>{label}</span>
                <span aria-hidden className="tab-mark lg:hidden" />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
