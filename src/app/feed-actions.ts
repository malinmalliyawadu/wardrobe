'use server'

import { revalidatePath } from 'next/cache'

import { echo, type ActionState } from '@/lib/action-state'
import { db } from '@/lib/db'
import { recordAction, type FeedAction } from '@/lib/feed'
import { storeFindPhoto, type FindPhoto } from '@/lib/find-photos'
import { PoliteClient } from '@/lib/finder/http'
import { addManualFind, ManualFindError, ManualFindSchema } from '@/lib/finder/manual'
import { addProductFromLink, ProductLinkError, storeForLink } from '@/lib/finder/product-link'
import { finish, number, text } from '@/lib/form-parse'
import { PhotoError } from '@/lib/photos'
import { listRetailers, readable, type Retailer } from '@/lib/retailers'

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
 * current by the nightly run. A shop whose site cannot be read (Lululemon)
 * takes what he typed in the form instead, and the photo he chose. A slot is
 * optional.
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
    const { url, retailer } = storeForLink(retailers, link)
    let productId: number
    if (readable(retailer)) {
      productId = (await addProductFromLink(sql, new PoliteClient(), retailers, link)).productId
    } else {
      const added = await addByHand(retailer, url, slotId, form)
      if ('errors' in added) return { ok: false, errors: added.errors, values: echo(form) }
      productId = added.productId
    }
    await recordAction({ action: 'saved', product_id: productId, slot_id: slotId })
  } catch (error) {
    if (error instanceof ProductLinkError) return { ok: false, errors: { link: error.message }, values: echo(form) }
    throw error
  }
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** The form's fields for a find from a store that cannot be read. What it is defaults to the slot's garment. */
async function addByHand(
  retailer: Retailer,
  url: URL,
  slotId: number | null,
  form: FormData,
): Promise<{ productId: number } | { errors: Record<string, string> }> {
  const sql = db()
  const [slot] = slotId
    ? await sql<{ garment_type: string }[]>`select garment_type from blueprint_slots where id = ${slotId}`
    : []
  const photo = number(form, 'photo_id')
  const parsed = finish(ManualFindSchema, {
    name: text(form, 'name') ?? '',
    garment_type: text(form, 'garment_type') ?? slot?.garment_type,
    price: price(text(form, 'price')),
    colour: text(form, 'colour'),
    size: text(form, 'size'),
    photo_id: photo === 'invalid' ? null : photo,
  })
  if (!parsed.ok) {
    const errors = { ...parsed.errors }
    if (errors.price) errors.price = 'Enter the price'
    if (errors.garment_type) errors.garment_type = 'Choose what it is'
    return { errors }
  }
  try {
    return { productId: await addManualFind(sql, retailer, url, parsed.data) }
  } catch (error) {
    if (error instanceof ManualFindError) return { errors: { photo_id: error.message } }
    throw error
  }
}

/** "$1,299.00", "129", "NZ$ 89.5" -> a number. Thousands commas go; a comma is never a decimal point in NZ. */
function price(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw.replace(/^[a-z]{0,3}\$?\s*/i, '').replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

export type FindPhotoState = { ok: boolean; photo?: FindPhoto; message?: string } | null

/**
 * The photo of a find he is adding by hand, stored as soon as he chooses it,
 * so a mistake elsewhere in the form never costs him the photo: the form only
 * carries its id.
 */
export async function chooseFindPhoto(_prev: FindPhotoState, form: FormData): Promise<FindPhotoState> {
  const upload = form.get('file')
  if (!(upload instanceof File) || upload.size === 0) return { ok: false, message: 'Choose a photo first.' }
  try {
    return { ok: true, photo: await storeFindPhoto({ bytes: Buffer.from(await upload.arrayBuffer()), mime: upload.type }) }
  } catch (error) {
    if (error instanceof PhotoError) return { ok: false, message: error.message }
    throw error
  }
}
