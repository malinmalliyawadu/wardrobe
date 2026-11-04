/**
 * CLI health check: the same checks as GET /api/health, for running from a
 * shell or a Coolify task. Exits non-zero if anything is down.
 *
 *   npm run health
 */

import { checkAll } from '../src/lib/health.ts'
import { db } from '../src/lib/db.ts'

const checks = await checkAll()

for (const check of checks) {
  process.stdout.write(
    `${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(9)} ${check.detail} (${check.latencyMs} ms)\n`,
  )
}

await db().end()
process.exit(checks.every((check) => check.ok) ? 0 : 1)
