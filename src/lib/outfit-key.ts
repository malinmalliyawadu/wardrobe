import type { Sql } from './db.ts'

/*
 * What makes two pictures, or a picture and a look, the same outfit: the same
 * wardrobe pieces and finds, in any order (migration 0016). "p12" is wardrobe
 * piece 12 and "f34" find 34, as the On me chooser already names them; the
 * key is those sorted byte-wise and joined with commas. Postgres builds the
 * same key for a look with `collate "C"`, which sorts as JavaScript does.
 */

export type OutfitItem = { piece_id: number | null; product_id?: number | null }

/** The key of what was or would be put together. */
export function outfitKey(items: OutfitItem[]): string {
  return items
    .map((item) => (item.piece_id !== null ? `p${item.piece_id}` : `f${item.product_id}`))
    .sort()
    .join(',')
}

/** The key of a choice as the chooser posts it: "p12" and "f34" tokens. */
export function choiceKey(tokens: string[]): string {
  return [...new Set(tokens)].sort().join(',')
}

/** The key of a find on its own, as a "See it on me" on it makes. */
export function findKey(productId: number): string {
  return `f${productId}`
}

/** The key of the look aliased `l`, from its pieces as they are now. */
export const lookOutfitKey = (sql: Sql) => sql`
  coalesce((
    select string_agg('p' || lp.piece_id, ',' order by ('p' || lp.piece_id) collate "C")
    from look_pieces lp where lp.look_id = l.id
  ), '')
`
