import { db, type Sql } from './db.ts'
import { checkUpload, normaliseImage, removePair, storePair, thumbName } from './photos.ts'
import { files } from './storage.ts'

/*
 * Photos of finds he adds by hand, from a store the finder cannot read
 * (migration 0012). Usually the shop's own product photo, saved from its page
 * on his phone. Stored like his photos (src/lib/photos.ts): a metadata-free
 * master and thumb in the file store, under finds/, served only through
 * /photos/finds/:id. The product's images list names that address, so the
 * cards, the try-on viewer and a piece bought from it show it like any shop
 * photo. It goes nowhere but the try-on editor, on his tap. The same kind of
 * photo is what he adds as his own for a find from a store that is read
 * (src/lib/product-photos.ts).
 */

export const FIND_DIR = 'finds'

/** A photo chosen for a find he then never added is cleared after this long. */
const ORPHAN_HOURS = 24

export type FindPhoto = { id: number; width: number; height: number }

export async function storeFindPhoto(input: { bytes: Buffer; mime: string }, sql: Sql = db()): Promise<FindPhoto> {
  checkUpload(input)
  const { master, thumb, sha256 } = await normaliseImage(input.bytes)
  const relative = `${FIND_DIR}/${sha256.slice(0, 24)}.jpg`

  await storePair(relative, master.data, thumb)

  // The same photo chosen twice is one file and one row, and counts as new, so the orphan sweep waits again.
  const [row] = await sql<{ id: number }[]>`
    insert into find_photos (path, bytes, width, height, sha256)
    values (${relative}, ${master.info.size}, ${master.info.width}, ${master.info.height}, ${sha256})
    on conflict (path) do update set created_at = now()
    returning id::int as id
  `
  if (!row) throw new Error('photo insert returned nothing')
  await clearFindOrphans(sql)
  return { id: row.id, width: master.info.width, height: master.info.height }
}

/**
 * Photos no product shows: chosen for a find never added, or replaced since.
 * A product shows one as a find added by hand (find_photo_id) or as the photo
 * he chose for it (chosen_image, src/lib/product-photos.ts).
 */
export async function clearFindOrphans(sql: Sql = db()): Promise<number> {
  const rows = await sql<{ path: string }[]>`
    delete from find_photos ph
    where ph.created_at < now() - make_interval(hours => ${ORPHAN_HOURS})
      and not exists (select 1 from products p where p.find_photo_id = ph.id)
      and not exists (select 1 from products p where p.chosen_image ->> 'src' = ${SRC_PREFIX} || ph.id::text)
    returning path
  `
  await Promise.all(rows.map((row) => removePair(row.path)))
  return rows.length
}

export async function findPhoto(id: number, sql: Sql = db()): Promise<FindPhoto | null> {
  const [row] = await sql<FindPhoto[]>`select id::int as id, width, height from find_photos where id = ${id}`
  return row ?? null
}

export async function findPhotoFile(id: number, variant: 'master' | 'thumb', sql: Sql = db()): Promise<Buffer | null> {
  const [row] = await sql<{ path: string }[]>`select path from find_photos where id = ${id}`
  if (!row) return null
  return files().get(variant === 'thumb' ? thumbName(row.path) : row.path)
}

const SRC_PREFIX = '/photos/finds/'

/** The address a product's images list gives for one of these photos. */
export function findPhotoSrc(id: number): string {
  return `${SRC_PREFIX}${id}`
}

/** The photo id in an image address, when the address is one of these. */
export function findPhotoId(src: string): number | null {
  const match = /^\/photos\/finds\/(\d+)(?:\?.*)?$/.exec(src)
  return match ? Number(match[1]) : null
}
