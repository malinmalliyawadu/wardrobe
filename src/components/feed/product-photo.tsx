'use client'

import Image, { type ImageLoader } from 'next/image'

import type { FindCard as Find } from '@/lib/feed'

/*
 * The product's photo, shared by the find card, the try-on viewer and Shops.
 * A client module because next/image takes the loader as a function.
 */

/**
 * Shopify's CDN (and Uniqlo's image host) resize on a width parameter, so the
 * image optimiser is not needed. The photo of a find added by hand is ours
 * (/photos/finds/:id), and its route picks the thumb or the master by width.
 */
export const productLoader: ImageLoader = ({ src, width }) => {
  if (src.startsWith('/') && !src.startsWith('//')) return `${src}?w=${width}`
  const url = new URL(src.startsWith('//') ? `https:${src}` : src)
  url.searchParams.set('width', String(width))
  return url.toString()
}

export function ProductPhoto({
  find,
  sizes,
  className = '',
}: {
  find: Pick<Find, 'image' | 'title'>
  sizes: string
  className?: string
}) {
  return (
    <div className={`photo relative overflow-hidden ${className}`}>
      {find.image ? (
        <Image
          loader={productLoader}
          src={find.image.src}
          alt={find.image.alt ?? find.title}
          fill
          sizes={sizes}
          className="object-contain"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-sm text-ink-3">No photo</span>
      )}
    </div>
  )
}
