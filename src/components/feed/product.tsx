import Image, { type ImageLoader } from 'next/image'

import type { FindCard as Find } from '@/lib/feed'

/* The product's photo and price, shared by the find card and the try-on viewer. */

/** Shopify's CDN resizes on a width parameter, so the image optimiser is not needed. */
const shopifyLoader: ImageLoader = ({ src, width }) => {
  const url = new URL(src.startsWith('//') ? `https:${src}` : src)
  url.searchParams.set('width', String(width))
  return url.toString()
}

export function ProductPhoto({ find, sizes, className = '' }: { find: Find; sizes: string; className?: string }) {
  return (
    <div className={`photo relative overflow-hidden ${className}`}>
      {find.image ? (
        <Image
          loader={shopifyLoader}
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

export const nzd = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-NZ')}`
const SYMBOLS: Record<string, string> = { GBP: '£', USD: 'US$', AUD: 'A$', EUR: '€' }
const foreign = (cents: number, currency: string) =>
  `${SYMBOLS[currency] ?? `${currency} `}${Math.round(cents / 100).toLocaleString('en-NZ')}`

export function PriceLine({ find }: { find: Find }) {
  const { price } = find
  if (price.currency !== 'NZD') {
    return (
      <p className="text-[0.9375rem] tabular-nums">
        <span className="font-medium">About {nzd(price.nzdCents)}</span>
        <span className="block text-[0.8125rem] text-ink-3">
          {foreign(price.cents, price.currency)} from the UK, plus duty and shipping
        </span>
      </p>
    )
  }
  return (
    <p className="text-[0.9375rem] tabular-nums">
      <span className="font-medium">{nzd(price.nzdCents)}</span>
      {price.compareAtNzdCents ? (
        <span className="ml-2 text-ink-3 line-through decoration-1">{nzd(price.compareAtNzdCents)}</span>
      ) : null}
    </p>
  )
}

