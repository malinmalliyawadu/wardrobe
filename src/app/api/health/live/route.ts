import { connection } from 'next/server'

import { checkDatabase } from '@/lib/health'

/**
 * GET /api/health/live
 *
 * The container health check: is the server up and can it reach Postgres.
 * Claude is left out on purpose. Coolify's proxy stops routing to a container
 * Docker marks unhealthy, so an Anthropic outage must not take the whole app
 * down with it; /api/health (behind the sign-in) still reports both. Open to
 * the world, so it says ok or not and nothing else.
 */
export async function GET(): Promise<Response> {
  await connection()
  const { ok } = await checkDatabase()
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } })
}
