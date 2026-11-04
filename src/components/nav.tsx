'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentType, SVGProps } from 'react'

import { BlueprintIcon, HangerIcon, PersonIcon, ShirtIcon } from './icons.tsx'

type Item = {
  href: '/' | '/looks' | '/blueprint' | '/you'
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

const items: Item[] = [
  { href: '/', label: 'Today', Icon: HangerIcon },
  { href: '/looks', label: 'Looks', Icon: ShirtIcon },
  { href: '/blueprint', label: 'Blueprint', Icon: BlueprintIcon },
  { href: '/you', label: 'You', Icon: PersonIcon },
]

export function Wordmark() {
  return (
    <Link href="/" className="inline-block font-display text-[1.375rem] italic tracking-[-0.01em] text-ink">
      Wardrobe
    </Link>
  )
}

/**
 * Four destinations. A bottom tab bar on the phone, a left rail from the
 * laptop breakpoint up. Switching tabs happens tens of times a day, so the
 * only motion is a 150ms colour change and the press feedback.
 *
 * The pathname is request data on dynamic routes (/blueprint/[id]), so the
 * layout renders Nav inside Suspense with NavShell, the same bar with nothing
 * marked, as the prerendered fallback.
 */
export function Nav() {
  return <NavBar pathname={usePathname()} />
}

export function NavShell() {
  return <NavBar pathname={null} />
}

function NavBar({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:sticky lg:top-0 lg:h-dvh lg:border-t-0 lg:border-r lg:bg-surface lg:px-4 lg:pt-10 lg:pb-8 lg:backdrop-blur-none"
    >
      <div className="hidden px-3 lg:block">
        <Wordmark />
      </div>
      <ul className="mx-auto flex max-w-md items-stretch justify-around lg:mt-10 lg:max-w-none lg:flex-col lg:gap-1">
        {items.map(({ href, label, Icon }) => {
          const active = pathname !== null && (pathname === href || (href !== '/' && pathname.startsWith(href)))
          return (
            <li key={href} className="lg:w-full">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                data-active={active}
                className="pressable flex min-h-14 min-w-18 flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-medium text-ink-3 transition-colors duration-150 ease-out data-[active=true]:text-brass lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:text-[0.9375rem] lg:data-[active=true]:bg-brass-soft"
              >
                <Icon className="size-6 lg:size-5" />
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
