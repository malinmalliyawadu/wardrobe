/**
 * Seeds the retailers table from data/retailers.json, matched on slug: new
 * stores are inserted, known ones updated in place, nothing is deleted (a
 * store dropped from the file stays, so its products keep their history; set
 * "enabled": false to stop reading it).
 *
 *   node --env-file-if-exists=.env scripts/seed-retailers.ts
 *
 * Also run by scripts/find.ts at the start of every run, so a store added to
 * the file is picked up the next night without a separate step, and by the
 * container on every deploy, so a corrected store address shows at once.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { connect } from '../src/lib/db.ts'
import { RetailerFileSchema, seedRetailers } from '../src/lib/retailers.ts'

export const RETAILERS_FILE = fileURLToPath(new URL('../data/retailers.json', import.meta.url))

export function readRetailerFile(path = RETAILERS_FILE) {
  return RetailerFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).retailers
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = connect({ max: 1 })
  try {
    const result = await seedRetailers(sql, readRetailerFile())
    process.stdout.write(JSON.stringify({ event: 'retailers.seeded', ...result }) + '\n')
  } finally {
    await sql.end()
  }
}
