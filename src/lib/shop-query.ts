import { z } from 'zod'

import { GARMENT_TYPES } from './wardrobe-values.ts'

/*
 * The Shops page's query, kept apart from the database code in shops.ts so
 * the search form on the client can share its labels and its shape.
 */

export const SHOPS_PAGE_SIZE = 24

export const SHOP_SORTS = ['closest', 'newest', 'price'] as const
export type ShopSort = (typeof SHOP_SORTS)[number]

/** Short, so four filters fit across a laptop; the line over the results says the rest. */
export const SORT_LABELS: Record<ShopSort, string> = {
  closest: 'Closest',
  newest: 'Newest',
  price: 'Cheapest',
}

export const SIZE_SCOPES = ['mine', 'any'] as const
export type SizeScope = (typeof SIZE_SCOPES)[number]

export const SIZE_LABELS: Record<SizeScope, string> = {
  mine: 'In your size',
  any: 'Every size',
}

/** Bad or missing parameters fall back to the defaults rather than failing the page. */
export const ShopQuerySchema = z.object({
  q: z.string().trim().max(100).catch(''),
  kind: z.enum(GARMENT_TYPES).nullable().catch(null),
  shop: z
    .string()
    .regex(/^[a-z0-9-]{1,60}$/)
    .nullable()
    .catch(null),
  size: z.enum(SIZE_SCOPES).catch('mine'),
  sort: z.enum(SHOP_SORTS).catch('closest'),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
})

export type ShopQuery = z.infer<typeof ShopQuerySchema>

type SearchParams = Record<string, string | string[] | undefined>

export function parseShopQuery(params: SearchParams): ShopQuery {
  const first = (key: string) => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? null
  }
  return ShopQuerySchema.parse({
    q: first('q') ?? '',
    kind: first('kind') || null,
    shop: first('shop') || null,
    size: first('size') ?? undefined,
    sort: first('sort') ?? undefined,
    page: first('page') ?? undefined,
  })
}

/** The query as URL parameters, defaults left out, so a plain /shops is the default view. */
export function shopQueryString(query: ShopQuery, page = query.page): string {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.kind) params.set('kind', query.kind)
  if (query.shop) params.set('shop', query.shop)
  if (query.size !== 'mine') params.set('size', query.size)
  if (query.sort !== 'closest') params.set('sort', query.sort)
  if (page > 1) params.set('page', String(page))
  const text = params.toString()
  return text ? `?${text}` : ''
}
