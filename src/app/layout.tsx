import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'

import './globals.css'

/*
 * One typeface, committed under src/fonts and loaded locally so `next build`
 * never reaches out to Google; the Docker build runs with the network off and
 * would otherwise fail on the deploy server. Instrument Sans is variable in
 * weight and width; the width axis is declared so `font-stretch` works, and
 * docs/design.md says which widths are for what.
 */
const instrument = localFont({
  src: [
    { path: '../fonts/instrument-sans-latin.woff2', weight: '400 700', style: 'normal' },
    { path: '../fonts/instrument-sans-latin-italic.woff2', weight: '400 700', style: 'italic' },
  ],
  declarations: [{ prop: 'font-stretch', value: '75% 100%' }],
  variable: '--font-instrument',
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
    { media: '(prefers-color-scheme: light)', color: '#f1f0ec' },
    { media: '(prefers-color-scheme: dark)', color: '#141b18' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-NZ" className={instrument.variable}>
      <body className="min-h-dvh bg-ground font-sans text-ink">{children}</body>
    </html>
  )
}
