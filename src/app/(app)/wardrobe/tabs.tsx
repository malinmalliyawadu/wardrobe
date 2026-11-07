import Link from 'next/link'
import type { ReactNode } from 'react'

import { PageTitle } from '@/components/section'

export type WardrobeSection = 'pieces' | 'looks' | 'on-me' | 'worn'

/**
 * The tab's four sections under its name: Pieces, Looks, On me, Worn. The open
 * one is ink with a rule under it. Switching is a plain navigation, so
 * nothing moves.
 */
export function WardrobeTabs({ current }: { current: WardrobeSection }) {
  const items = [
    { key: 'pieces', href: '/wardrobe', label: 'Pieces' },
    { key: 'looks', href: '/wardrobe/looks', label: 'Looks' },
    { key: 'on-me', href: '/wardrobe/on-me', label: 'On me' },
    { key: 'worn', href: '/wardrobe/worn', label: 'Worn' },
  ] as const
  return (
    <nav aria-label="Pieces, looks, pictures of you and what you wear" className="subnav mt-8">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? 'page' : undefined}
          className="subnav-item pressable"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}

/**
 * The head every section page shares: "Wardrobe", one line of what is true
 * now, the page's one action at the right, then the sections.
 */
export function WardrobeHead({ current, line, aside }: { current: WardrobeSection; line?: ReactNode; aside?: ReactNode }) {
  return (
    <>
      <PageTitle title="Wardrobe" line={line} aside={aside} />
      <WardrobeTabs current={current} />
    </>
  )
}
