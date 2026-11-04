/** Whole New Zealand dollars from cents: 26000 -> "$260", 120000 -> "$1,200". */
export function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-NZ')}`
}

/** A budget band as Malin reads it. */
export function band(minCents: number | null, maxCents: number | null): string | null {
  if (minCents === null && maxCents === null) return null
  if (minCents === null) return `Up to ${money(maxCents as number)}`
  if (maxCents === null) return `From ${money(minCents)}`
  if (minCents === maxCents) return money(minCents)
  return `${money(minCents)} to ${money(maxCents)}`
}

/** "4 November", in New Zealand time. */
export function day(date: Date): string {
  return date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', timeZone: 'Pacific/Auckland' })
}
