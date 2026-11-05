'use client'

import Image, { type ImageLoader } from 'next/image'

import type { FindCard as Find } from '@/lib/feed'
import { productImageAt } from '@/lib/product-image'

/*
 * The product's photo, shared by the find card, the try-on viewer and Shops.
 * A client module because next/image takes the loader as a function.
 */

/** The shops' image hosts resize on their own, so the image optimiser is not needed. */
export const productLoader: ImageLoader = ({ src, width }) => productImageAt(src, width)

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
