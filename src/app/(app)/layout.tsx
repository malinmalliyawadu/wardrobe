import { Suspense } from 'react'

import { ColourTip } from '@/components/colour-tip'
import { LivePalette } from '@/components/live-palette'
import { Nav, NavShell, Wordmark } from '@/components/nav'
import { PaletteStrip } from '@/components/palette-strip'

/**
 * The frame. On the laptop, where this is mostly read, a rail down the left
 * holds the wordmark, his palette and the five tabs, and the page beside it
 * is a wide spread. On the phone the wordmark and palette sit at the top and
 * the tabs along the bottom. The sign-in page sits outside it, with none of
 * this to show.
 */
export default function AppLayout({ children }: LayoutProps<'/'>) {
  const strip = (
    <Suspense fallback={<PaletteStrip colours={null} />}>
      <LivePalette />
    </Suspense>
  )
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[15rem_minmax(0,1fr)]">
      <Suspense fallback={<NavShell strip={strip} />}>
        <Nav strip={strip} />
      </Suspense>
      <div className="min-w-0">
        <header className="flex items-center justify-between px-[var(--gutter)] pt-[calc(0.875rem+env(safe-area-inset-top))] pb-3 lg:hidden">
          <Wordmark />
          {strip}
        </header>
        <main className="mx-auto w-full max-w-[76rem] px-[var(--gutter)] pt-2 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pt-12 lg:pb-24">
          {children}
        </main>
      </div>
      <ColourTip />
    </div>
  )
}
