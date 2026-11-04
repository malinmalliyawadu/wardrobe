import type { Sql } from '../db.ts'

import type { Rates } from './filter.ts'

/*
 * Rates for turning a foreign store's price into NZD, read once per run from
 * the European Central Bank's reference rates (via Frankfurter's v2 API, no key).
 * Prices are stored in the store's own currency and converted only for the
 * budget check and for display, at the rate the run recorded. If the lookup
 * fails, the last run's rates are used, and failing that a conservative
 * constant, so a rates outage never stops the finder.
 */

/** On the high side (November 2026), so an outage errs toward over budget, never under. */
export const FALLBACK_RATES: Rates = { NZD: 1, GBP: 2.4, AUD: 1.15, USD: 1.8, EUR: 2.05 }

export type RatesResult = { rates: Rates; source: 'ecb' | 'last_run' | 'fallback'; date: string | null }

export async function loadRates(sql: Sql, currencies: string[], fetcher: typeof fetch = fetch): Promise<RatesResult> {
  const foreign = [...new Set(currencies)].filter((currency) => currency !== 'NZD')
  if (foreign.length === 0) return { rates: { NZD: 1 }, source: 'ecb', date: null }

  try {
    const rates: Rates = { NZD: 1 }
    let date: string | null = null
    for (const currency of foreign) {
      const response = await fetcher(`https://api.frankfurter.dev/v2/rates?base=${currency}&quotes=NZD`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`rates answered ${response.status}`)
      const body = (await response.json()) as { date?: string; quote?: string; rate?: number }[]
      const answer = Array.isArray(body) ? body.find((row) => row.quote === 'NZD') : undefined
      const rate = answer?.rate
      if (typeof rate !== 'number' || !(rate > 0)) throw new Error('rates answer had no NZD rate')
      rates[currency] = rate
      date = answer?.date ?? date
    }
    return { rates, source: 'ecb', date }
  } catch {
    const [last] = await sql<{ fx: { rates?: Rates; date?: string } | null }[]>`
      select stats -> 'fx' as fx from finder_runs
      where status = 'succeeded' and stats ? 'fx' order by started_at desc limit 1
    `
    const lastRates = last?.fx?.rates
    if (lastRates && foreign.every((currency) => typeof lastRates[currency] === 'number')) {
      return { rates: lastRates, source: 'last_run', date: last.fx?.date ?? null }
    }
    return { rates: FALLBACK_RATES, source: 'fallback', date: null }
  }
}
