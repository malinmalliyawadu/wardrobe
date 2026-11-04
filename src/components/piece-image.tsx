'use client'

import Image from 'next/image'
import type { CSSProperties } from 'react'

import type { ProductImage } from '@/lib/finder/shopify'
import type { PiecePhoto } from '@/lib/pieces'

import { shopifyLoader } from './feed/product'

export type PieceLook = {
  name: string
  colour_hex: string | null
  photo: PiecePhoto | null
  image: ProductImage | null
}

/**
 * A piece as a picture: his own photo, cropped to fill; or the shop's photo,
 * whole, on the photo ground; or, with neither, the cloth in its colour. The
 * caller sets the box (aspect and rounding) through className.
 */
export function PieceImage({
  piece,
  sizes,
  className = '',
  thumb = true,
}: {
  piece: PieceLook
  sizes: string
  className?: string
  thumb?: boolean
}) {
  if (piece.photo) {
    return (
      <div className={`photo relative overflow-hidden ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/photos/wardrobe/${piece.photo.id}${thumb ? '?v=thumb' : ''}`}
          alt={piece.name}
          width={piece.photo.width}
          height={piece.photo.height}
          loading="lazy"
          className="absolute inset-0 size-full object-cover [mix-blend-mode:normal]"
        />
      </div>
    )
  }
  if (piece.image) {
    return (
      <div className={`photo relative overflow-hidden ${className}`}>
        <Image loader={shopifyLoader} src={piece.image.src} alt={piece.image.alt ?? piece.name} fill sizes={sizes} className="object-contain" />
      </div>
    )
  }
  return (
    <div
      role="img"
      aria-label={piece.name}
      className={`cloth relative overflow-hidden ${className}`}
      style={{ '--swatch': piece.colour_hex ?? 'var(--surface)' } as CSSProperties}
    />
  )
}
