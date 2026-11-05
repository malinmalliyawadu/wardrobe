import { z } from 'zod'

import { db, type Sql } from '../db.ts'
import { finish, number, type ParseResult } from '../form-parse.ts'
import { WALKED_PLATFORMS } from '../retailers.ts'

import { SHOW_THRESHOLD } from './score.ts'

/*
 * The finder's settings, edited on /you/finder: what it may spend on Claude (a
 * nightly cap and an optional monthly one, in US dollars, which is what
 * Anthropic bills) and which stores it reads. The caps are the one-row
 * finder_settings table (judging statement pieces has a nightly cap of its
 * own, inside the same month); the stores are retailers.enabled, which the ingest,
 * the filter and the feed all respect, so a store switched off goes from the
 * feed at once and is not read again.
 */

export type FinderSettings = {
  max_usd_per_run: number
  max_usd_per_month: number | null
  /** What one search on the Search tab may spend; it counts toward the month too. */
  max_usd_per_search: number
  /** What judging statement pieces may spend a night, on top of the slots; the month counts both. */
  max_usd_statements: number
}

/** The form's values: the caps, and the slugs of the stores left on. */
export type FinderForm = FinderSettings & { stores: string[] }

export const DEFAULT_SETTINGS: FinderSettings = {
  max_usd_per_run: 1,
  max_usd_per_month: null,
  max_usd_per_search: 0.5,
  max_usd_statements: 0.5,
}

const usd = z.number().min(0).max(1000)

export const FinderFormSchema = z.object({
  max_usd_per_run: usd,
  max_usd_per_month: usd.nullable(),
  max_usd_per_search: usd,
  max_usd_statements: usd,
  stores: z.array(z.string().regex(/^[a-z0-9-]+$/)),
})

export async function getFinderSettings(sql: Sql = db()): Promise<FinderSettings> {
  const [row] = await sql<FinderSettings[]>`
    select max_usd_per_run::float as max_usd_per_run, max_usd_per_month::float as max_usd_per_month,
           max_usd_per_search::float as max_usd_per_search, max_usd_statements::float as max_usd_statements
    from finder_settings where id = 1
  `
  return row ?? DEFAULT_SETTINGS
}

/** The caps and the store switches together, in one transaction. Unknown slugs are ignored. */
export async function saveFinderSettings(values: FinderForm, sql: Sql = db()): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      insert into finder_settings (id, max_usd_per_run, max_usd_per_month, max_usd_per_search, max_usd_statements)
      values (
        1, ${values.max_usd_per_run}, ${values.max_usd_per_month}, ${values.max_usd_per_search}, ${values.max_usd_statements}
      )
      on conflict (id) do update
      set max_usd_per_run = excluded.max_usd_per_run, max_usd_per_month = excluded.max_usd_per_month,
          max_usd_per_search = excluded.max_usd_per_search, max_usd_statements = excluded.max_usd_statements
    `
    await tx`update retailers set enabled = (slug = any (${values.stores}::text[]))`
  })
}

export function parseFinderSettingsForm(form: FormData): ParseResult<FinderForm> {
  const perRun = number(form, 'max_usd_per_run')
  if (perRun === null) return { ok: false, errors: { max_usd_per_run: 'Give a nightly limit; 0 turns judging off' } }
  const perSearch = number(form, 'max_usd_per_search')
  if (perSearch === null) return { ok: false, errors: { max_usd_per_search: 'Give a limit; 0 turns search off' } }
  const statements = number(form, 'max_usd_statements')
  if (statements === null) {
    return { ok: false, errors: { max_usd_statements: 'Give a nightly limit; 0 turns statement pieces off' } }
  }
  const stores = [...new Set(form.getAll('stores').filter((value): value is string => typeof value === 'string'))]
  if (stores.length === 0) return { ok: false, errors: { stores: 'Keep at least one shop on' } }
  const parsed = finish(FinderFormSchema, {
    max_usd_per_run: perRun,
    max_usd_per_month: number(form, 'max_usd_per_month'),
    max_usd_per_search: perSearch,
    max_usd_statements: statements,
    stores,
  })
  if (!parsed.ok) return parsed
  const rounded = {
    stores: parsed.data.stores,
    max_usd_per_run: Math.round(parsed.data.max_usd_per_run * 100) / 100,
    max_usd_per_month:
      parsed.data.max_usd_per_month === null ? null : Math.round(parsed.data.max_usd_per_month * 100) / 100,
    max_usd_per_search: Math.round(parsed.data.max_usd_per_search * 100) / 100,
    max_usd_statements: Math.round(parsed.data.max_usd_statements * 100) / 100,
  }
  // A month that cannot cover one night of both is not a month's limit.
  const night = Math.round((rounded.max_usd_per_run + rounded.max_usd_statements) * 100) / 100
  if (rounded.max_usd_per_month !== null && rounded.max_usd_per_month < night) {
    return { ok: false, errors: { max_usd_per_month: `At least the two nightly limits together, ${usdText(night)}` } }
  }
  return { ok: true, data: rounded }
}

export type Spend = {
  /** Claude spend by runs and searches started this calendar month, New Zealand time. */
  thisMonth: number
  lastRun: { usd: number; scored: number; finished_at: Date | null; started_at: Date } | null
  /** Measured cost of one score over the last 30 days, when there is one. */
  perScore: number | null
}

export async function getSpend(sql: Sql = db()): Promise<Spend> {
  const [[month], [last], [average]] = await Promise.all([
    sql<{ usd: number }[]>`
      with month as (
        select date_trunc('month', now() at time zone 'Pacific/Auckland') at time zone 'Pacific/Auckland' as start
      )
      select (
        coalesce((select sum((stats ->> 'usd')::numeric) from finder_runs where started_at >= (select start from month)), 0)
        + coalesce((select sum(usd) from searches where started_at >= (select start from month)), 0)
      )::float as usd
    `,
    sql<{ usd: number; scored: number; finished_at: Date | null; started_at: Date }[]>`
      select coalesce((stats ->> 'usd')::numeric, 0)::float as usd,
             (coalesce((stats ->> 'scored')::int, 0) + coalesce((stats -> 'statements' ->> 'scored')::int, 0)) as scored,
             finished_at, started_at
      from finder_runs where status <> 'running' and stats ? 'scoring' and stats -> 'scoring' <> 'null'::jsonb
      order by started_at desc limit 1
    `,
    sql<{ usd: number | null }[]>`
      select avg(usd)::float as usd from (
        select usd from product_scores where scored_at > now() - interval '30 days'
        union all
        select usd from statement_scores where scored_at > now() - interval '30 days'
      ) judged
    `,
  ])
  return { thisMonth: month?.usd ?? 0, lastRun: last ?? null, perScore: average?.usd ?? null }
}

export type RunBudget = {
  /** What this run may spend on scoring. */
  max_usd: number
  /** Which limit set it. */
  limited_by: 'flag' | 'night' | 'month'
  per_run: number
  per_month: number | null
  spent_this_month: number
}

/**
 * The run's budget: the nightly cap (or the --max-usd flag, for a one-off),
 * held under what is left of the monthly cap. The month always applies; a flag
 * cannot spend past it.
 */
export function runBudget(settings: FinderSettings, spentThisMonth: number, flag: number | null): RunBudget {
  const perRun = flag ?? settings.max_usd_per_run
  const base: RunBudget = {
    max_usd: perRun,
    limited_by: flag === null ? 'night' : 'flag',
    per_run: settings.max_usd_per_run,
    per_month: settings.max_usd_per_month,
    spent_this_month: Math.round(spentThisMonth * 10000) / 10000,
  }
  if (settings.max_usd_per_month === null) return base
  const left = Math.max(0, settings.max_usd_per_month - spentThisMonth)
  return left < perRun ? { ...base, max_usd: Math.round(left * 10000) / 10000, limited_by: 'month' } : base
}

/**
 * What judging statement pieces may spend this run: their nightly cap (or the
 * --statements-usd flag), held under what the month has left once the slots
 * were judged.
 */
export function statementsBudget(settings: FinderSettings, spentThisMonth: number, flag: number | null): RunBudget {
  return runBudget({ ...settings, max_usd_per_run: settings.max_usd_statements }, spentThisMonth, flag)
}

/** "US$1", "US$0.50", "US$7.78". */
export function usdText(value: number): string {
  return `US$${Number.isInteger(value) ? value : value.toFixed(2)}`
}

export type StoreCount = {
  slug: string
  name: string
  enabled: boolean
  /** Menswear pieces it has now. */
  products: number
  /** How many made the latest run's shortlist: what Claude is asked to judge. */
  shortlisted: number
  /** Of those, how many cleared the bar for a slot. */
  finds: number
  /** What judging its pieces cost in the latest run that judged anything. */
  usd: number
}

/**
 * Each store with what it brings and what it costs, the costliest first: the
 * numbers he needs to decide which to keep reading.
 */
export async function storeCounts(sql: Sql = db()): Promise<StoreCount[]> {
  return sql<StoreCount[]>`
    with latest as (
      select r.id from finder_runs r
      where exists (select 1 from finder_candidates c where c.run_id = r.id)
      order by r.started_at desc limit 1
    ),
    judged as (
      select r.id from finder_runs r
      where exists (select 1 from product_scores s where s.run_id = r.id)
      order by r.started_at desc limit 1
    )
    select r.slug, r.name, r.enabled,
           count(p.id) filter (where p.menswear and p.removed_at is null)::int as products,
           count(c.product_id)::int as shortlisted,
           count(c.product_id) filter (where exists (
             select 1 from product_scores s
             where s.product_id = c.product_id and s.content_hash = c.content_hash
               and s.score >= ${SHOW_THRESHOLD} and s.slot_id = any (c.slot_ids)
           ))::int as finds,
           coalesce((
             select sum(s.usd) from product_scores s join products q on q.id = s.product_id
             where q.retailer_id = r.id and s.run_id = (select id from judged)
           ), 0)::float as usd
    from retailers r
    left join products p on p.retailer_id = r.id
    left join finder_candidates c on c.product_id = p.id and c.run_id = (select id from latest)
    -- A store read only from pasted links (Uniqlo, Rodd & Gunn) is never walked, so it has no switch.
    where r.platform = any (${[...WALKED_PLATFORMS]}::text[])
    group by r.id
    order by count(c.product_id) desc, r.name
  `
}
