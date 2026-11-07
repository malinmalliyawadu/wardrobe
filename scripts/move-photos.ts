/**
 * Moves the photos folder into R2, once, from inside the app container on
 * Coolify (the folder is the old /data volume):
 *
 *   npm run photos:move              copy every file up, check each landed whole
 *   npm run photos:move -- --prune   the same, then delete each local copy R2 holds
 *
 * Needs the four R2 settings (src/lib/storage.ts) and PHOTOS_DIR, which the
 * image sets to /data/photos. Safe to run again: a file R2 already holds with
 * the same MD5 is not sent again. A local file is deleted only with --prune,
 * and only once R2's copy has the same MD5.
 *
 * Then it asks R2 for every file a row names (his photos and their thumbs,
 * pieces, finds, try-ons, flat lays) and lists any it does not have, so the
 * move is known to be complete before the volume goes.
 *
 * Output is one JSON object per line. Exits non-zero if a file failed or a
 * row names a file R2 does not have.
 */

import { parseArgs } from 'node:util'

import { db } from '../src/lib/db.ts'
import { thumbName } from '../src/lib/photos.ts'
import { copyFiles, files, folderKeys, folderStore, missingKeys, photosDir } from '../src/lib/storage.ts'

const { values: options } = parseArgs({ options: { prune: { type: 'boolean', default: false } } })

const log = (event: string, fields: Record<string, unknown> = {}) => process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`)

const r2 = files()
if (r2.kind !== 'r2') {
  log('move.no_r2', { message: 'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET first.' })
  process.exit(1)
}

const dir = photosDir()
const keys = await folderKeys(dir)
log('move.start', { from: dir, to: r2.where, files: keys.length, prune: options.prune })

const copied = await copyFiles(keys, folderStore(dir), r2, { prune: options.prune })
for (const failure of copied.failed) log('move.failed', failure)
log('move.copied', { copied: copied.copied, already: copied.already, pruned: copied.pruned, failed: copied.failed.length })

// Every file a row still names, as the app would ask for it.
const named = await db()<{ path: string; thumb: boolean }[]>`
  select path, true as thumb from profile_photos where deleted_at is null
  union all select path, true from wardrobe_photos
  union all select path, true from find_photos
  union all select path, false from try_ons where deleted_at is null and path is not null
  union all select path, false from look_images where path is not null
`
await db().end()
const wanted = named.flatMap((row) => (row.thumb ? [row.path, thumbName(row.path)] : [row.path]))
const missing = await missingKeys(wanted, r2)
if (missing.length > 0) log('move.missing', { count: missing.length, keys: missing })

const ok = copied.failed.length === 0 && missing.length === 0
log('move.done', { named: wanted.length, missing: missing.length, ok })
process.exit(ok ? 0 : 1)
