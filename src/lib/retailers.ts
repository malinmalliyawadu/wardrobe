import { z } from 'zod'

import type { Sql } from './db.ts'

/*
 * Where the finder looks. The list lives in data/retailers.json and is seeded
 * into the retailers table by scripts/seed-retailers.ts, matched on slug, so
 * the file is the source of truth for names and URLs and the table carries
 * what the runs learn (robots.txt, last ingest).
 */

const url = z
  .string()
  .url()
  .transform((value) => value.replace(/\/+$/, ''))

export const WellingtonStoreSchema = z.object({
  name: z.string().min(1),
  /** The street or area, from memory until verified. Never shown on its own. */
  area: z.string().nullable(),
  address: z.string().nullable(),
  verified: z.boolean(),
})

export const RetailerSeedSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  platform: z.enum(['shopify', 'custom']),
  base_url: url,
  /** Where /products.json is read, when it is not the public site. */
  feed_url: url.optional(),
  /** Collection handles holding the men's range, read instead of the whole catalogue. */
  feed_collections: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  country: z.string().length(2),
  currency: z.string().length(3),
  ships_to_nz: z.boolean(),
  /** "menswear" when the whole catalogue is men's, "mixed" when it has to be read per product. */
  catalogue: z.enum(['menswear', 'mixed']),
  notes: z.string().optional(),
  enabled: z.boolean().default(true),
  wellington_store: WellingtonStoreSchema.nullable(),
})

export const RetailerFileSchema = z.object({
  retailers: z.array(RetailerSeedSchema).min(1),
})

export type RetailerSeed = z.infer<typeof RetailerSeedSchema>
export type WellingtonStore = z.infer<typeof WellingtonStoreSchema>

export type Retailer = {
  id: number
  slug: string
  name: string
  platform: 'shopify' | 'custom'
  base_url: string
  feed_url: string | null
  feed_collections: string[]
  country: string
  currency: string
  ships_to_nz: boolean
  catalogue: 'menswear' | 'mixed'
  wellington_store: WellingtonStore | null
  enabled: boolean
}

/** The store to name in "try on at", only once its address is verified. */
export function tryOnAt(store: WellingtonStore | null): string | null {
  if (!store?.verified || !store.address) return null
  return `${store.name}, ${store.address}`
}

export async function seedRetailers(sql: Sql, seeds: RetailerSeed[]): Promise<{ inserted: number; updated: number }> {
  let inserted = 0
  let updated = 0
  for (const seed of seeds) {
    const row = {
      slug: seed.slug,
      name: seed.name,
      platform: seed.platform,
      base_url: seed.base_url,
      feed_url: seed.feed_url ?? null,
      feed_collections: seed.feed_collections,
      country: seed.country,
      currency: seed.currency,
      ships_to_nz: seed.ships_to_nz,
      catalogue: seed.catalogue,
      notes: seed.notes ?? null,
      enabled: seed.enabled,
      wellington_store: seed.wellington_store ? sql.json(seed.wellington_store) : null,
    }
    const [result] = await sql<{ inserted: boolean }[]>`
      insert into retailers ${sql(row)}
      on conflict (slug) do update set
        name = excluded.name,
        platform = excluded.platform,
        base_url = excluded.base_url,
        feed_url = excluded.feed_url,
        feed_collections = excluded.feed_collections,
        country = excluded.country,
        currency = excluded.currency,
        ships_to_nz = excluded.ships_to_nz,
        catalogue = excluded.catalogue,
        notes = excluded.notes,
        enabled = excluded.enabled,
        wellington_store = excluded.wellington_store
      returning (xmax = 0) as inserted
    `
    if (result?.inserted) inserted += 1
    else updated += 1
  }
  return { inserted, updated }
}

export async function listRetailers(sql: Sql): Promise<Retailer[]> {
  return sql<Retailer[]>`
    select id::int as id, slug, name, platform, base_url, feed_url, feed_collections, country, currency,
           ships_to_nz, catalogue, wellington_store, enabled
    from retailers order by name
  `
}
