import type { MetadataRoute } from 'next'

/**
 * What installing Wardrobe to the home screen reads. Served outside the
 * sign-in gate (see src/proxy.ts), since the phone may fetch it without the
 * cookie. The icons are drawn by scripts/icons.ts. No service worker: the
 * app is no use offline, and a cached Today would show stale prices.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Wardrobe',
    short_name: 'Wardrobe',
    description: 'A personal stylist that learns what suits you and finds it in Wellington and online.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // The dark ground, which the icon is drawn on, so the splash and the icon agree.
    background_color: '#141b18',
    theme_color: '#141b18',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
