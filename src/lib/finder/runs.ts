import { db, type Sql } from '../db.ts'

/*
 * One finder run at a time. The nightly task and a run started from
 * /you/finder are the same script, and two at once would read every shop
 * twice and judge the same pieces twice. So a run holds a Postgres advisory
 * lock for its whole life, on a connection of its own: a second run that
 * cannot take it stops before it starts. The lock goes when the process does,
 * however it ends, so it is also the honest answer to "is a run going": a row
 * still marked running without the lock behind it belongs to a run that died.
 */

/** The lock's two keys: the app's, and the finder's within it. */
const LOCK = [0x77617264, 1] as const

export type FinderLock = { release: () => Promise<void> }

/** Takes the finder's lock, or answers null when another run holds it. */
export async function holdFinderLock(sql: Sql = db()): Promise<FinderLock | null> {
  const reserved = await sql.reserve()
  try {
    const [row] = await reserved<{ locked: boolean }[]>`select pg_try_advisory_lock(${LOCK[0]}, ${LOCK[1]}) as locked`
    if (!row?.locked) {
      reserved.release()
      return null
    }
  } catch (error) {
    reserved.release()
    throw error
  }
  return {
    release: async () => {
      try {
        await reserved`select pg_advisory_unlock(${LOCK[0]}, ${LOCK[1]})`
      } finally {
        reserved.release()
      }
    },
  }
}

const INTERRUPTED = 'Stopped before it finished: the process ended (a restart or a redeploy) partway through.'

/**
 * Closes the rows of runs that died without saying so. Only safe while
 * holding the lock, when no other run can be alive. Answers how many.
 */
export async function closeInterrupted(sql: Sql = db()): Promise<number> {
  const rows = await sql`
    update finder_runs set status = 'failed', finished_at = coalesce(finished_at, now()), error = ${INTERRUPTED}
    where status = 'running'
    returning id
  `
  return rows.length
}

export type LiveRun = {
  id: number
  started_at: Date
  /** Reading the shops and filtering, which is free; then judging, which is not. */
  stage: 'reading' | 'judging'
  /** Candidates the filter passed, once it has. */
  candidates: number | null
  /** Judged so far, and what that has cost. */
  judged: number
  usd: number
}

/** The run going now, if one is: the newest running row, while the lock is held. */
export async function liveRun(sql: Sql = db()): Promise<LiveRun | null> {
  const [row] = await sql<(Omit<LiveRun, 'stage'> & { filtered: boolean })[]>`
    select r.id::int as id, r.started_at, r.stats ? 'filter' as filtered,
           (r.stats ->> 'candidates')::int as candidates,
           count(s.product_id)::int as judged, coalesce(sum(s.usd), 0)::float as usd
    from finder_runs r
    left join product_scores s on s.run_id = r.id
    where r.status = 'running'
      and exists (
        select 1 from pg_locks l
        where l.locktype = 'advisory' and l.granted
          and l.database = (select oid from pg_database where datname = current_database())
          and l.classid = ${LOCK[0]} and l.objid = ${LOCK[1]} and l.objsubid = 2
      )
    group by r.id
    order by r.started_at desc limit 1
  `
  if (!row) return null
  const { filtered, ...run } = row
  return { ...run, stage: filtered ? 'judging' : 'reading' }
}
