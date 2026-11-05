/**
 * The nightly finder. Runs as a Coolify scheduled task inside the app image:
 *
 *   node scripts/find.ts
 *   npm run find -- --only=barkers,huffer --max-usd=2
 *
 * How much it may spend, and which stores it reads, are set on /you/finder,
 * which can also start a run now; that runs this same script.
 *
 * One run at a time: a run that finds another going logs `find.busy` and
 * exits 0 without starting (see src/lib/finder/runs.ts).
 *
 * Four stages, each recorded in one finder_runs row:
 *   1. ingest   every enabled store's Shopify feed, politely (free)
 *   2. filter   menswear, the slot's garment, in his size, in the slot's band, not
 *               dismissed, not plainly the wrong colour (free; reads a photo once
 *               when the listing names no colour)
 *   3. score    new or changed candidates, with Sonnet (costs tokens)
 *   4. statements  free rules pick likely statement pieces from everything read,
 *               and Sonnet judges new or changed ones within their own nightly
 *               cap (src/lib/finder/statements.ts)
 *
 * Options:
 *   --only=a,b        ingest only these retailer slugs (the filter still reads everything)
 *   --skip-ingest     filter and score what is already stored
 *   --reclassify      re-apply the classification rules to stored products (implies --skip-ingest)
 *   --no-score        do not judge the slots' candidates
 *   --no-statements   do not look for statement pieces
 *   --max-usd=N       spend up to N US dollars on scoring this run, instead of the
 *                     nightly limit set on /you/finder (the monthly limit still applies)
 *   --statements-usd=N  spend up to N US dollars judging statement pieces, instead
 *                     of their nightly limit (the monthly limit still applies)
 *   --concurrency=N   scores in flight at once (default 6)
 *
 * Output is one JSON object per line. Exits non-zero if the run failed.
 */

import { parseArgs } from 'node:util'

import { listSlots } from '../src/lib/blueprint.ts'
import { db } from '../src/lib/db.ts'
import { findCandidates, recordCandidates, slotTargets } from '../src/lib/finder/filter.ts'
import { loadRates } from '../src/lib/finder/fx.ts'
import { PoliteClient } from '../src/lib/finder/http.ts'
import { readPhoto } from '../src/lib/finder/photo-colour.ts'
import { refreshSaved } from '../src/lib/finder/product-link.ts'
import { closeInterrupted, holdFinderLock } from '../src/lib/finder/runs.ts'
import { ingestRetailer, reclassify, type RetailerIngest } from '../src/lib/finder/ingest.ts'
import { contextBlock, scoreAll, SHOW_THRESHOLD, unscored, type ScoreStats } from '../src/lib/finder/score.ts'
import { getFinderSettings, getSpend, runBudget, statementsBudget } from '../src/lib/finder/settings.ts'
import {
  findStatementCandidates,
  judgeStatements,
  recordStatementCandidates,
  STATEMENT_THRESHOLD,
  unjudgedStatements,
} from '../src/lib/finder/statements.ts'
import { listPieces } from '../src/lib/pieces.ts'
import { productImageAt } from '../src/lib/product-image.ts'
import { getProfile } from '../src/lib/profile.ts'
import { listRetailers, seedRetailers, walkedNightly } from '../src/lib/retailers.ts'
import { colourNameFor, getGuide } from '../src/lib/style-guide.ts'

import { readRetailerFile } from './seed-retailers.ts'

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    'skip-ingest': { type: 'boolean', default: false },
    reclassify: { type: 'boolean', default: false },
    'no-score': { type: 'boolean', default: false },
    'no-statements': { type: 'boolean', default: false },
    'max-usd': { type: 'string' },
    'statements-usd': { type: 'string' },
    concurrency: { type: 'string', default: '6' },
  },
})

const options = {
  only: args.only ? args.only.split(',').map((slug) => slug.trim()).filter(Boolean) : null,
  // Re-applying the rules to stored products replaces reading the stores.
  skipIngest: args['skip-ingest'] || args.reclassify,
  reclassify: args.reclassify,
  score: !args['no-score'],
  statements: !args['no-statements'],
  maxUsd: args['max-usd'] === undefined ? null : Number(args['max-usd']),
  statementsUsd: args['statements-usd'] === undefined ? null : Number(args['statements-usd']),
  concurrency: Math.max(1, Math.min(16, Number(args.concurrency) || 6)),
}
if (options.maxUsd !== null && !(options.maxUsd >= 0)) throw new Error('--max-usd must be a number of dollars')
if (options.statementsUsd !== null && !(options.statementsUsd >= 0)) {
  throw new Error('--statements-usd must be a number of dollars')
}

function log(fields: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...fields }) + '\n')
}

// The lib functions read through the shared pool, so the script uses it too
// and ends it on the way out.
const sql = db()

const lock = await holdFinderLock(sql)
if (!lock) {
  log({ event: 'find.busy', reason: 'another finder run is going' })
  await sql.end()
  process.exit(0)
}
const interrupted = await closeInterrupted(sql)
if (interrupted > 0) log({ event: 'find.closed_interrupted', runs: interrupted })

const [run] = await sql<{ id: number; started_at: Date }[]>`
  insert into finder_runs (options) values (${sql.json(options)}) returning id::int as id, started_at
`
if (!run) throw new Error('could not start a finder run')
log({ event: 'find.start', run: run.id, options })
const runStartedAt = run.started_at

const stats: Record<string, unknown> = {}
let exitCode = 0

try {
  const seeded = await seedRetailers(sql, readRetailerFile())
  log({ event: 'find.retailers', ...seeded })
  const allRetailers = await listRetailers(sql)
  // Only a store the finder walks can be switched on; one read only from
  // pasted links (Uniqlo, Rodd & Gunn) never is, whatever its row says.
  const retailers = allRetailers.filter((retailer) => retailer.enabled && walkedNightly(retailer))

  // 1. Ingest. Stores run side by side; each host gets its own one-a-second queue.
  if (!options.skipIngest) {
    const client = new PoliteClient()
    const chosen = retailers.filter((retailer) => !options.only || options.only.includes(retailer.slug))
    const results: RetailerIngest[] = await Promise.all(
      chosen.map(async (retailer) => {
        const result = await ingestRetailer(sql, client, retailer, log)
        log({ event: 'ingest.retailer', ...result })
        return result
      }),
    )
    stats.ingested = {
      products: sum(results, 'products'),
      menswear: sum(results, 'menswear'),
      variants: sum(results, 'variants'),
      new: sum(results, 'new'),
      changed: sum(results, 'changed'),
      removed: sum(results, 'removed'),
      observations: sum(results, 'observations'),
      retailers: results,
    }
    // Saved products the walk did not cover (a pasted link outside the men's
    // collection) are read one by one, so their price and stock stay current.
    stats.saved_refreshed = await refreshSaved(sql, client, allRetailers, runStartedAt)
    log({ event: 'ingest.saved', ...(stats.saved_refreshed as object) })
    stats.saved_price_drops = await savedPriceDrops()
  }

  if (options.reclassify) {
    const result = await reclassify(sql, retailers)
    stats.reclassified = result
    log({ event: 'find.reclassified', ...result })
  }

  // 2. Filter.
  const [profile, guide, slots, settings, spend] = await Promise.all([
    getProfile(),
    getGuide(),
    listSlots(),
    getFinderSettings(sql),
    getSpend(sql),
  ])
  const budget = runBudget(settings, spend.thisMonth, options.maxUsd)
  stats.budget = budget
  stats.stores_on = retailers.length
  // Every store's currency, not only the walked ones': Saved shows links from
  // stores switched off, and from Uniqlo, in NZD at this run's rate.
  const fx = await loadRates(sql, allRetailers.map((retailer) => retailer.currency))
  stats.fx = fx
  const targets = slotTargets(
    slots,
    profile.sizes,
    (hex) => colourNameFor(guide, hex),
    (garment) => guide?.fit_vocabulary.find((entry) => entry.garment === garment)?.fits ?? [],
  )
  const photos = new PoliteClient()
  const { candidates, stats: filtered } = await findCandidates(sql, targets, fx.rates, {
    readPhoto: async (src) => (await readPhoto(await photos.bytes(productImageAt(src, 160)))).colours,
  })
  await recordCandidates(sql, run.id, candidates)
  stats.slots_open = targets.length
  stats.slots_size_unknown = targets.filter((target) => target.sizes === null).length
  stats.filter = filtered
  stats.candidates = candidates.length
  log({ event: 'filter.done', slots: targets.length, ...filtered })
  // Saved now, not only at the end: the feed shows a run's finds while it is
  // still scoring, and needs its exchange rates to price END. in NZD.
  await sql`update finder_runs set stats = ${sql.json(stats as never)} where id = ${run.id}`

  // 3. Score.
  let scoring: ScoreStats | null = null
  if (options.score && candidates.length > 0) {
    if (!guide) throw new Error('No style guide yet: the scorer has nothing to judge against.')
    const products = await unscored(sql, candidates, slots)
    const openSlots = slots.filter((slot) => targets.some((target) => target.slot_id === slot.id))
    const dismissals = await recentDismissals()
    const context = contextBlock({ profile, guide, slots: openSlots, dismissals })
    log({ event: 'score.start', needed: products.length, ...budget })
    scoring = await scoreAll(sql, run.id, context, products, {
      maxUsd: budget.max_usd,
      concurrency: options.concurrency,
      log,
    })
    log({ event: 'score.done', ...scoring })
  }
  stats.scored = scoring?.scored ?? 0
  stats.scoring = scoring
  stats.usd = scoring?.usd ?? 0
  stats.shown = await shownCount(run.id)

  // 4. Statement pieces: the rules over everything read, then Sonnet on what
  // it has not judged, within its own cap and what the month has left.
  let statements: ScoreStats | null = null
  if (options.statements && guide) {
    const { candidates: picked, stats: rules } = await findStatementCandidates(sql, {
      sizes: profile.sizes,
      budget: profile.budget,
      slots,
      guide,
      rates: fx.rates,
    })
    await recordStatementCandidates(sql, run.id, picked)
    stats.statement_rules = rules
    log({ event: 'statements.rules', ...rules })
    const products = await unjudgedStatements(sql, picked)
    const allowed = statementsBudget(settings, spend.thisMonth + (scoring?.usd ?? 0), options.statementsUsd)
    stats.statements_budget = allowed
    log({ event: 'statements.start', needed: products.length, ...allowed })
    const [pieces, dismissals] = await Promise.all([listPieces(sql), recentDismissals()])
    statements = await judgeStatements(sql, run.id, { profile, guide, pieces, dismissals }, products, {
      maxUsd: allowed.max_usd,
      concurrency: options.concurrency,
      log,
    })
    log({ event: 'statements.done', ...statements })
    stats.statements = statements
    stats.statements_shown = await statementsShown(run.id)
    // The run's spend, which the month's cap counts, is both stages together.
    stats.usd = Number(((scoring?.usd ?? 0) + statements.usd).toFixed(4))
  }

  // A run whose scoring was stopped (no credit, an outage) still succeeded:
  // what it found and scored is good, and the rest is scored next run. It
  // says why in the error column and exits non-zero, so the task is flagged.
  const stopped = scoring?.stopped ?? statements?.stopped ?? null
  await sql`
    update finder_runs set status = 'succeeded', finished_at = now(), stats = ${sql.json(stats as never)}, error = ${stopped}
    where id = ${run.id}
  `
  log({
    event: 'find.complete',
    run: run.id,
    candidates: stats.candidates,
    scored: stats.scored,
    shown: stats.shown,
    statements: stats.statements_shown ?? null,
    usd: stats.usd,
  })
  if (stopped) {
    exitCode = 1
    log({ event: 'find.incomplete', run: run.id, reason: stopped })
  }
} catch (error) {
  exitCode = 1
  const message = (error as Error).message
  await sql`
    update finder_runs set status = 'failed', finished_at = now(), stats = ${sql.json(stats as never)}, error = ${message}
    where id = ${run.id}
  `
  log({ event: 'find.failed', run: run.id, error: message })
} finally {
  await lock.release()
  await sql.end()
}
process.exit(exitCode)

function sum(results: RetailerIngest[], key: keyof RetailerIngest): number {
  return results.reduce((total, result) => total + (typeof result[key] === 'number' ? (result[key] as number) : 0), 0)
}

/** Saved products whose cheapest in-stock price is now below the price they were saved at. */
async function savedPriceDrops(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    with saved as (
      select distinct on (product_id) product_id, action, price_cents
      from feed_actions order by product_id, created_at desc, id desc
    )
    select count(*)::int as count from saved s
    where s.action = 'saved' and s.price_cents is not null
      and (select min(v.price_cents) from product_variants v where v.product_id = s.product_id and v.available) < s.price_cents
  `
  return row?.count ?? 0
}

/** The last 40 dismissals, so the scorer learns his taste. */
async function recentDismissals() {
  return sql<{ title: string; reason: string | null; note: string | null }[]>`
    select p.title, a.reason, a.note from feed_actions a join products p on p.id = a.product_id
    where a.action = 'dismissed'
    order by a.created_at desc limit 40
  `
}

/** The statement pieces this run's shortlist has over the bar, nothing done with them yet. */
async function statementsShown(runId: number): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from statement_candidates c
    join statement_scores s on s.product_id = c.product_id and s.content_hash = c.content_hash
    where c.run_id = ${runId} and s.score >= ${STATEMENT_THRESHOLD}
      and coalesce((
        select a.action from feed_actions a where a.product_id = c.product_id
        order by a.created_at desc, a.id desc limit 1
      ), 'cleared') = 'cleared'
  `
  return row?.count ?? 0
}

/**
 * What the feed will show from this run: candidates whose current score clears
 * the threshold for an open slot they were offered, and that he has not saved,
 * dismissed or bought.
 */
async function shownCount(runId: number): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from finder_candidates c
    join product_scores s on s.product_id = c.product_id and s.content_hash = c.content_hash
    join blueprint_slots b on b.id = s.slot_id and b.status in ('wanted', 'candidate')
    where c.run_id = ${runId} and s.score >= ${SHOW_THRESHOLD} and s.slot_id = any (c.slot_ids)
      and coalesce((
        select a.action from feed_actions a where a.product_id = c.product_id
        order by a.created_at desc, a.id desc limit 1
      ), 'cleared') = 'cleared'
  `
  return row?.count ?? 0
}
