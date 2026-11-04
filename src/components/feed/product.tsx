import type { FindCard as Find } from '@/lib/feed'

/* The product's price and sizes, shared by the find card, the try-on viewer and Shops. */

export const nzd = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-NZ')}`
const SYMBOLS: Record<string, string> = { GBP: '£', USD: 'US$', AUD: 'A$', EUR: '€' }
const foreign = (cents: number, currency: string) =>
  `${SYMBOLS[currency] ?? `${currency} `}${Math.round(cents / 100).toLocaleString('en-NZ')}`

export function PriceLine({ find }: { find: Pick<Find, 'price'> }) {
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

/** "34 inch Waist x 32 inch Leg" reads as "34/32" on a card. */
function shortSize(label: string): string {
  const waistLeg = /^(\d{2})\s*(?:"|inch(?:es)?|in)?\s*waist\s*x\s*(\d{2})\s*(?:"|inch(?:es)?|in)?\s*leg$/i.exec(label.trim())
  return waistLeg ? `${waistLeg[1]}/${waistLeg[2]}` : label
}

export function sizeLine(find: Pick<Find, 'sizes' | 'size_known'>): string {
  if (find.sizes.length === 1 && /^one size$/i.test(find.sizes[0]!)) return 'One size'
  const sizes = [...new Set(find.sizes.map(shortSize))]
  if (find.size_known) return `Your ${sizes.join(', ')} in stock`
  const shown = sizes.slice(0, 6).join(', ')
  return `In stock: ${shown}${sizes.length > 6 ? ' and more' : ''}`
}
