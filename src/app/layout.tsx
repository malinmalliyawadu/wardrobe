import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Suspense } from 'react'

import { Nav, NavShell, Wordmark } from '@/components/nav'

import './globals.css'

/*
 * Fonts are committed under src/fonts and loaded locally so `next build`
 * never reaches out to Google; the Docker build runs with the network off and
 * would otherwise fail on the deploy server. Both are variable fonts.
 */
const display = localFont({
  src: [
    { path: '../fonts/newsreader-latin.woff2', weight: '200 800', style: 'normal' },
    { path: '../fonts/newsreader-latin-italic.woff2', weight: '200 800', style: 'italic' },
  ],
  variable: '--font-newsreader',
  display: 'swap',
})

const sans = localFont({
  src: [
    { path: '../fonts/hanken-grotesk-latin.woff2', weight: '100 900', style: 'normal' },
    { path: '../fonts/hanken-grotesk-latin-italic.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-hanken',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Wardrobe',
    template: '%s, Wardrobe',
  },
  description: 'A personal stylist that learns what suits you and finds it in Wellington and online.',
  appleWebApp: {
    capable: true,
    title: 'Wardrobe',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e8e6e1' },
    { media: '(prefers-color-scheme: dark)', color: '#181c23' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-NZ" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh bg-ground font-sans text-ink">
        <div className="lg:grid lg:min-h-dvh lg:grid-cols-[13rem_minmax(0,1fr)]">
          <Suspense fallback={<NavShell />}>
            <Nav />
          </Suspense>
          <div className="min-w-0">
            <header className="px-5 pt-[calc(1rem+env(safe-area-inset-top))] lg:hidden">
              <Wordmark />
            </header>
            <main className="mx-auto w-full max-w-2xl px-5 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-12 lg:pt-16 lg:pb-20">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  )
}
