import { connection } from 'next/server'

import { liveRun } from '@/lib/finder/runs'

/**
 * GET /api/finder/run
 *
 * The finder run going now, or null: what "Run now" on /you/finder asks every
 * few seconds while a run is on. A route rather than a server action, so
 * polling never queues behind a save.
 */
export async function GET(): Promise<Response> {
  await connection()
  return Response.json({ run: await liveRun() }, { headers: { 'cache-control': 'no-store' } })
}
