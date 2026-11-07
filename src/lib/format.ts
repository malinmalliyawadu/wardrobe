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

/** "once", "twice", "3 times". */
export function times(count: number): string {
  return count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`
}

/** A New Zealand date as YYYY-MM-DD, as "2 November". */
export function nzDay(date: string): string {
  return day(new Date(`${date}T12:00:00+13:00`))
}

/** How often a look or a piece was offered and worn (src/lib/wear.ts). */
export type WearCounts = {
  offered: number
  /** Of the offers, the days on Today. Said for a look. */
  on_today?: number
  /** The looks it was offered in. Said for a piece. */
  looks?: number
  worn: number
  /** YYYY-MM-DD in New Zealand. */
  last_worn: string | null
}

/**
 * "Offered 7 times, 3 on Today. Worn once, on 2 November." for a look;
 * "Offered 9 times, in 4 looks. Never worn." for a piece; "Never in a look
 * yet." for a piece no look has worn.
 */
export function wearLine(wear: WearCounts): string {
  if (wear.offered === 0 && wear.worn === 0) return 'Never in a look yet.'
  const parts = [`Offered ${times(wear.offered)}`]
  if (wear.looks && wear.looks > 1) parts.push(`in ${wear.looks} looks`)
  if (wear.on_today) {
    parts.push(wear.on_today === wear.offered ? (wear.offered === 1 ? 'on Today' : 'all on Today') : `${wear.on_today} on Today`)
  }
  const offered = wear.offered > 0 ? `${parts.join(', ')}. ` : ''
  if (wear.worn === 0 || !wear.last_worn) return `${offered}Never worn.`
  const last = nzDay(wear.last_worn)
  return `${offered}${wear.worn === 1 ? `Worn once, on ${last}` : `Worn ${times(wear.worn)}, last on ${last}`}.`
}

/**
 * A look card's line of how it has done, once there is something to say:
 * worn at least once, or offered more than the once that brought it here.
 */
export function lookWearLine(look: { offered: number; on_today: number; worn: string[] }): string | null {
  if (look.worn.length === 0 && look.offered < 2) return null
  return wearLine({ offered: look.offered, on_today: look.on_today, worn: look.worn.length, last_worn: look.worn[0] ?? null })
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
