'use server'

import { revalidatePath } from 'next/cache'

import { echo, type ActionState } from '@/lib/action-state'
import { db } from '@/lib/db'
import { recordAction, type FeedAction } from '@/lib/feed'
import { PoliteClient } from '@/lib/finder/http'
import { addProductFromLink, ProductLinkError } from '@/lib/finder/product-link'
import { listRetailers } from '@/lib/retailers'

/**
 * Save, un-save, dismiss with a reason, and mark as bought, from the feed on
 * Today. The input is checked by the schema in recordAction; the card hides
 * itself optimistically, and the revalidation brings the slot statuses (and
 * the Blueprint tab) along.
 */
export async function feedAction(input: FeedAction): Promise<{ ok: boolean }> {
  try {
    await recordAction(input)
  } catch {
    return { ok: false }
  }
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Adds a product he pasted a link to, from any of the shops, to Saved. The
 * product is read from the shop there and then, stored like a find, and kept
 * current by the nightly run. A slot is optional.
 */
export async function addLinkToSaved(_prev: ActionState, form: FormData): Promise<ActionState> {
  const link = form.get('link')
  if (typeof link !== 'string' || link.trim() === '') {
    return { ok: false, errors: { link: 'Paste a product link' }, values: echo(form) }
  }
  const slot = Number(form.get('slot_id'))
  const slotId = Number.isInteger(slot) && slot > 0 ? slot : null
  try {
    const sql = db()
    const retailers = await listRetailers(sql)
    const { productId } = await addProductFromLink(sql, new PoliteClient(), retailers, link)
    await recordAction({ action: 'saved', product_id: productId, slot_id: slotId })
  } catch (error) {
    if (error instanceof ProductLinkError) return { ok: false, errors: { link: error.message }, values: echo(form) }
    throw error
  }
  revalidatePath('/', 'layout')
  return { ok: true }
}
