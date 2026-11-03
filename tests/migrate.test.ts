import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

/**
 * The migration runner is the one piece of infrastructure code with logic of
 * its own, so it gets a real test against a real database. Needs DATABASE_URL;
 * fails rather than skips when it is missing, so CI has to provide one.
 */

type Line = { event: string; applied?: number; total?: number }

function migrate(...args: string[]): Line[] {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the migration test')
  const out = execFileSync(process.execPath, ['scripts/migrate.ts', ...args], {
    encoding: 'utf8',
    env: process.env,
  })
  return out
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Line)
}

test('a reset applies every migration, and a second run applies none', () => {
  const first = migrate('--reset')
  const firstDone = first.at(-1)
  assert.equal(firstDone?.event, 'migrate.complete')
  assert.ok(firstDone?.total && firstDone.total > 0, 'expected at least one migration file')
  assert.equal(firstDone.applied, firstDone.total)

  const second = migrate()
  const secondDone = second.at(-1)
  assert.equal(secondDone?.event, 'migrate.complete')
  assert.equal(secondDone?.applied, 0)
  assert.equal(secondDone?.total, firstDone.total)
})
