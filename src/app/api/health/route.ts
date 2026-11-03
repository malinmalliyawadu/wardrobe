import { connection } from 'next/server'

import { checkAll } from '@/lib/health'

/**
 * GET /api/health
 *
 * Used by the Docker HEALTHCHECK and by Coolify. 200 when both the database
 * and Claude answer, 503 otherwise, with the detail in the body either way.
 * connection() marks the route as request-time so the build does not try to
 * prerender a database call.
 */
export async function GET(): Promise<Response> {
  await connection()
  const checks = await checkAll()
  const ok = checks.every((check) => check.ok)
  return Response.json(
    { ok, checks },
    {
      status: ok ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  )
}
