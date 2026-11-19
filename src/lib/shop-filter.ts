/*
 * A filter by shop over a list that mixes finds from several stores (the
 * wishlist, the statement pieces). It offers only the shops in the list, and
 * the URL keeps the choice as `shop`, the store's slug, as on Shops.
 */

export type ShopOption = { value: string; label: string }

type Listed = { shop: string; retailer: string; fromPhoto?: boolean }

/** Wishes from a photo come from no shop; they are one choice of their own, after the shops. */
export const FROM_A_PHOTO = 'From a photo'

/** Each shop in the list once, by name, with wishes from a photo last. */
export function shopOptions(finds: readonly Listed[]): ShopOption[] {
  const shops = new Map<string, { label: string; photo: boolean }>()
  for (const find of finds) {
    if (shops.has(find.shop)) continue
    shops.set(find.shop, { label: find.fromPhoto ? FROM_A_PHOTO : find.retailer, photo: find.fromPhoto ?? false })
  }
  return [...shops.entries()]
    .sort(([, a], [, b]) => Number(a.photo) - Number(b.photo) || a.label.localeCompare(b.label, 'en-NZ'))
    .map(([value, { label }]) => ({ value, label }))
}

/** The shop asked for, when the list has it; a stale or made-up one shows everything. */
export function chosenShop(value: string | string[] | undefined, options: readonly ShopOption[]): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return options.some((option) => option.value === first) ? first! : null
}

/** The path with the shop set or cleared, every other parameter kept. */
export function withShop(path: string, params: Record<string, string | null>, shop: string | null): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...params, shop })) if (value) query.set(key, value)
  const text = query.toString()
  return text ? `${path}?${text}` : path
}
