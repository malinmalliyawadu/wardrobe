import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'

import { connect } from '../src/lib/db.ts'

/**
 * The migration runner is the one piece of infrastructure code with logic of
 * its own, so it gets a real test against a real database. It runs in a
 * scratch database created for the test, never the one DATABASE_URL names:
 * the --reset path drops the whole public schema, and the development
 * database will hold Malin's profile.
 */

type Line = { event: string; applied?: number; total?: number }

const scratch = `wardrobe_test_${process.pid}_${Date.now()}`
let admin: ReturnType<typeof connect>
let scratchUrl: string

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the migration test')
  admin = connect({ max: 1 })
  await admin.unsafe(`create database ${scratch}`)
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `/${scratch}`
  scratchUrl = url.toString()
})

after(async () => {
  await admin.unsafe(`drop database if exists ${scratch} with (force)`)
  await admin.end()
})

function migrate(...args: string[]): Line[] {
  const out = execFileSync(process.execPath, ['scripts/migrate.ts', ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: scratchUrl },
  })
  return out
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Line)
}

test('a fresh database applies every migration, and a second run applies none', () => {
  const first = migrate()
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

test('--reset drops everything and rebuilds from zero', () => {
  const lines = migrate('--reset')
  assert.ok(lines.some((line) => line.event === 'migrate.reset'))
  const done = lines.at(-1)
  assert.equal(done?.event, 'migrate.complete')
  assert.equal(done?.applied, done?.total)
})
