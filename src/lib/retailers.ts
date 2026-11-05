import { z } from 'zod'

import type { Sql } from './db.ts'

/*
 * Where the finder looks. The list lives in data/retailers.json and is seeded
 * into the retailers table by scripts/seed-retailers.ts, matched on slug, so
 * the file is the source of truth for names and URLs and the table carries
 * what the runs learn (robots.txt, last ingest).
 */

export const PLATFORMS = ['shopify', 'rodd-and-gunn', 'uniqlo', 'manual'] as const

export type Platform = (typeof PLATFORMS)[number]

/** The platforms the nightly finder reads whole, so the ones with a switch on /you/finder. */
export const WALKED_PLATFORMS = ['shopify'] as const satisfies readonly Platform[]

/**
 * The platforms whose pages say which sizes are in stock. Uniqlo's page does
 * not (every size it makes counts as available), and a find added by hand
 * has only the size he typed.
 */
export const STOCK_PLATFORMS = ['shopify', 'rodd-and-gunn'] as const satisfies readonly Platform[]

const url = z
  .string()
  .url()
  .transform((value) => value.replace(/\/+$/, ''))

export const WellingtonStoreSchema = z
  .object({
    name: z.string().min(1),
    /** The street or area, from memory until verified. Never shown on its own. */
    area: z.string().nullable(),
    address: z.string().nullable(),
    verified: z.boolean(),
    /** The page on the retailer's own site the address was read from. */
    source: z.string().url().nullable().optional(),
    /** The day it was read there, YYYY-MM-DD. */
    checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .refine((store) => !store.verified || (store.address && store.source && store.checked), {
    message: 'A verified store needs the address, the page on its own site it came from, and the day it was checked',
  })

export const RetailerSeedSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /**
   * How a product is read. "shopify": the whole catalogue from /products.json
   * every night, and one product from /products/<handle>.js. "uniqlo" and
   * "rodd-and-gunn": one product at a time from its own page, only for a link
   * he pastes; never walked, so never on the finder's switches (Rodd & Gunn's
   * catalogue is a page per colour, too slow to walk at a page a second).
   * "manual": a site that cannot
   * be read at all (Lululemon's answers with a bot challenge), so a find from
   * it is typed in by him on Saved, and never checked again.
   */
  platform: z.enum(PLATFORMS),
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
  /** Whether a newly added store starts on. After that, /you/finder decides. */
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
  platform: Platform
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

/** Whether the nightly finder reads the store's whole catalogue, and so whether it has a switch. */
export function walkedNightly(retailer: Pick<Retailer, 'platform'>): boolean {
  return (WALKED_PLATFORMS as readonly Platform[]).includes(retailer.platform)
}

/** Whether a product can be read from the store's site at all, or is only ever typed in by him. */
export function readable(retailer: Pick<Retailer, 'platform'>): boolean {
  return retailer.platform !== 'manual'
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
        -- enabled is set once, when a store is added: after that it is
        -- Malin's switch on /you/finder, and the file must not undo it.
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
