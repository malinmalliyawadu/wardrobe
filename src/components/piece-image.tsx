'use client'

import Image from 'next/image'
import type { CSSProperties } from 'react'

import type { ProductImage } from '@/lib/finder/shopify'
import type { PiecePhoto } from '@/lib/pieces'

import { productLoader } from './feed/product-photo'

export type PieceLook = {
  name: string
  colour_hex: string | null
  colour_name?: string | null
  photo: PiecePhoto | null
  image: ProductImage | null
}

/**
 * A piece as a picture: his own photo, cropped to fill; or the shop's photo,
 * whole, on the photo ground; or, with neither, the cloth in its colour,
 * named under the mouse like any swatch. The caller sets the box (aspect and
 * rounding) through className.
 */
export function PieceImage({
  piece,
  sizes,
  className = '',
  thumb = true,
  label,
  colour,
}: {
  piece: PieceLook
  sizes: string
  className?: string
  thumb?: boolean
  /** Shown on the cloth when there is no photo, where nothing else says what the piece is. */
  label?: string
  /** The cloth's colour name, when the caller has a better one than the piece's own (the guide's). */
  colour?: string | null
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
        <Image loader={productLoader} src={piece.image.src} alt={piece.image.alt ?? piece.name} fill sizes={sizes} className="object-contain" />
      </div>
    )
  }
  return (
    <div
      role="img"
      aria-label={piece.name}
      data-colour={(piece.colour_hex && (colour ?? piece.colour_name)) || undefined}
      className={`swatch relative overflow-hidden ${className}`}
      style={{ '--swatch': piece.colour_hex ?? 'var(--surface)' } as CSSProperties}
    >
      {label ? (
        <span
          aria-hidden
          className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-[2px] bg-ground/85 px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-2"
        >
          {label}
        </span>
      ) : null}
    </div>
  )
}
