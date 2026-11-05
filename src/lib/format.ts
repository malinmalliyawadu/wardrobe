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

/** "Worn twice, last on 2 November.", from the days a look was worn, newest first, as YYYY-MM-DD. */
export function wornLine(worn: string[]): string | null {
  if (worn.length === 0) return null
  const times = worn.length === 1 ? 'once' : worn.length === 2 ? 'twice' : `${worn.length} times`
  return `Worn ${times}, last on ${day(new Date(`${worn[0]}T12:00:00+13:00`))}.`
}

/** "two tops, a pair of trousers and a pair of shoes" */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

const ZONE = 'Pacific/Auckland'

/**
 * When something happened, as he would say it in Wellington: "last night"
 * (after 8pm yesterday or before 8am today, which is when the finder runs),
 * "today", "yesterday", "on Tuesday" within the week, then "on 4 November".
 */
export function whenSaid(date: Date, now = new Date()): string {
  const dayOf = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: ZONE })
  const hour = Number(date.toLocaleString('en-NZ', { hour: 'numeric', hourCycle: 'h23', timeZone: ZONE }))
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000)
  if ((dayOf(date) === dayOf(now) && hour < 8) || (dayOf(date) === dayOf(yesterday) && hour >= 20)) return 'last night'
  if (dayOf(date) === dayOf(now)) return 'today'
  if (dayOf(date) === dayOf(yesterday)) return 'yesterday'
  if (now.getTime() - date.getTime() < 6 * 24 * 3600 * 1000) {
    return `on ${date.toLocaleDateString('en-NZ', { weekday: 'long', timeZone: ZONE })}`
  }
  return `on ${day(date)}`
}
