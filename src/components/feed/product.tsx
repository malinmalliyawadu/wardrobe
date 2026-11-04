import type { FindCard as Find } from '@/lib/feed'

/* The product's price and sizes, shared by the find card, the try-on viewer and Shops. */

export const nzd = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-NZ')}`
const SYMBOLS: Record<string, string> = { GBP: '£', USD: 'US$', AUD: 'A$', EUR: '€' }
const foreign = (cents: number, currency: string) =>
  `${SYMBOLS[currency] ?? `${currency} `}${Math.round(cents / 100).toLocaleString('en-NZ')}`
const COUNTRIES: Record<string, string> = { GB: 'the UK', US: 'the US', AU: 'Australia' }
const countryName = (code: string) => COUNTRIES[code] ?? new Intl.DisplayNames(['en-NZ'], { type: 'region' }).of(code) ?? code

export function PriceLine({ find }: { find: Pick<Find, 'price'> }) {
  const { price } = find
  if (price.currency !== 'NZD') {
    return (
      <p className="text-[0.9375rem] tabular-nums">
        <span className="font-medium">About {nzd(price.nzdCents)}</span>
        <span className="block text-[0.8125rem] text-ink-3">
          {price.shipsToNz
            ? `${foreign(price.cents, price.currency)} from ${countryName(price.country)}, plus duty and shipping`
            : `${foreign(price.cents, price.currency)} in ${countryName(price.country)}, and it does not ship to NZ`}
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

export function sizeLine(find: Pick<Find, 'sizes' | 'size_known' | 'stock_known'>): string {
  if (find.sizes.length === 1 && /^one size$/i.test(find.sizes[0]!)) return 'One size'
  const sizes = [...new Set(find.sizes.map(shortSize))]
  // A store whose page gives no stock: these are the sizes it makes, not the ones it has.
  if (!find.stock_known) {
    if (find.size_known) return `Made in your ${sizes.join(', ')}; the shop’s page has the stock`
    const range = sizes.length > 1 ? `Sizes ${sizes[0]} to ${sizes.at(-1)}` : `Size ${sizes[0]}`
    return `${range}; the shop’s page has the stock`
  }
  if (find.size_known) return `Your ${sizes.join(', ')} in stock`
  const shown = sizes.slice(0, 6).join(', ')
  return `In stock: ${shown}${sizes.length > 6 ? ' and more' : ''}`
}
