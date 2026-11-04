import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'

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
      <body className="min-h-dvh bg-ground font-sans text-ink">{children}</body>
    </html>
  )
}
