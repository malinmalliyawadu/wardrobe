/*
 * A shop's product photo at a width. Every shop the finder reads serves its
 * photos from a host that resizes them itself, so a photo is asked for at the
 * size it is used and the app never resizes one: Shopify's CDN and Uniqlo's
 * image host take ?width=, and Salesforce Commerce Cloud's image service
 * (Rodd & Gunn, under /dw/image/) takes ?sw= with sm=fit to keep the whole
 * garment in frame. A host that resizes on nothing gets the photo as it is.
 * The photo of a find added by hand is ours (/photos/finds/:id), and its
 * route picks the thumb or the master by ?w=.
 *
 * Shared by the find cards (next/image's loader), the finder (photo colours,
 * Claude's look at the product) and try-on, so it imports nothing.
 */

export function productImageAt(src: string, width: number): string {
  if (src.startsWith('/') && !src.startsWith('//')) return `${src}?w=${width}`
  const url = new URL(src.startsWith('//') ? `https:${src}` : src)
  if (url.hostname.endsWith('cdn.shopify.com') || url.pathname.includes('/cdn/shop/') || url.hostname === 'image.uniqlo.com') {
    url.searchParams.set('width', String(width))
  } else if (url.pathname.startsWith('/dw/image/')) {
    url.searchParams.set('sw', String(width))
    url.searchParams.delete('sh')
    url.searchParams.set('sm', 'fit')
  }
  return url.toString()
}
