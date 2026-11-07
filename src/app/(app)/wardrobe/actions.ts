'use server'

import Anthropic from '@anthropic-ai/sdk'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'

import { echo, type ActionState } from '@/lib/action-state'
import { db } from '@/lib/db'
import { PoliteClient } from '@/lib/finder/http'
import { makeLookImage, startLookImage } from '@/lib/look-image'
import { runRemake, startRemake, type RemakeAsk } from '@/lib/look-remake'
import { readPhoto } from '@/lib/finder/photo-colour'
import { addProductFromLink, ManualStoreError, ProductLinkError } from '@/lib/finder/product-link'
import { attachPhoto, PieceReadError, readPiecePhoto, storePiecePhoto, valuesFromRead } from '@/lib/piece-photos'
import {
  createPiece,
  deletePiece,
  draftFromProduct,
  listPieces,
  parseOrigin,
  parsePieceForm,
  PieceError,
  restorePiece,
  setAside,
  updatePiece,
  type PieceDraft,
} from '@/lib/pieces'
import { PhotoError, removePair } from '@/lib/photos'
import { text } from '@/lib/form-parse'
import {
  actOnLook,
  draftLooks,
  gymReadiness,
  dressable,
  readHistory,
  readiness,
  readinessAround,
  saveSet,
  wantedSlots,
  wellingtonToday,
  type LookAction,
} from '@/lib/looks'
import { getProfile } from '@/lib/profile'
import { listRetailers } from '@/lib/retailers'
import { GenerationError } from '@/lib/structured'
import { getGuide } from '@/lib/style-guide'
import { fetchProductImage } from '@/lib/try-on'

/** What the add form's first step returns: the values to start the form from. */
export type DraftState = (NonNullable<ActionState> & { draft?: PieceDraft }) | null

/** Every mutation touches Today, the blueprint and the looks, so refresh the tree. */
function refreshAll(): void {
  revalidatePath('/', 'layout')
}

function id(form: FormData): number | null {
  const value = Number(form.get('id'))
  return Number.isInteger(value) && value > 0 ? value : null
}

function file(form: FormData): File | null {
  const value = form.get('file')
  return value instanceof File && value.size > 0 ? value : null
}

/**
 * A photo of a piece: stored, its colour read here, then read by Claude
 * (Sonnet) to fill in the form. If Claude cannot read it, the form still
 * opens with the colour, and he fills in the rest.
 */
export async function draftFromPhoto(_prev: DraftState, form: FormData): Promise<DraftState> {
  const upload = file(form)
  if (!upload) return { ok: false, message: 'Choose a photo first.' }
  let stored
  try {
    stored = await storePiecePhoto({ bytes: Buffer.from(await upload.arrayBuffer()), mime: upload.type })
  } catch (error) {
    if (error instanceof PhotoError) return { ok: false, message: error.message }
    throw error
  }
  const guide = await getGuide()
  let note: string | null = null
  let values
  try {
    const read = await readPiecePhoto(stored, guide)
    values = valuesFromRead(read, stored.colourHex, guide)
    if (!read.is_garment) note = 'Claude was not sure this photo shows one piece. Check every field.'
  } catch (error) {
    if (!(error instanceof PieceReadError || error instanceof Anthropic.APIError)) throw error
    values = valuesFromRead(null, stored.colourHex, guide)
    note = 'Claude could not read the photo, so only the colour is filled in. Add the rest.'
  }
  return {
    ok: true,
    draft: {
      source: 'photo',
      photo_id: stored.id,
      product_id: null,
      values,
      preview: { photo: { id: stored.id, width: stored.width, height: stored.height } },
      note,
    },
  }
}

/** A product page from one of the shops: read there, stored like a find, and its details start the form. */
export async function draftFromLink(_prev: DraftState, form: FormData): Promise<DraftState> {
  const link = form.get('link')
  if (typeof link !== 'string' || link.trim() === '') {
    return { ok: false, errors: { link: 'Paste a product link' }, values: echo(form) }
  }
  try {
    const sql = db()
    const { productId } = await addProductFromLink(sql, new PoliteClient(), await listRetailers(sql), link)
    const draft = await draftFromProduct(productId, await getGuide(), async (src) => {
      try {
        return (await readPhoto(await fetchProductImage(src))).hex
      } catch {
        return null
      }
    })
    // The link stays in its field, so he can see what was read.
    return { ok: true, draft, values: echo(form) }
  } catch (error) {
    if (error instanceof ManualStoreError) {
      const message = `${error.retailer.name}’s site cannot be read automatically. Add it from a photo, or type it in.`
      return { ok: false, errors: { link: message }, values: echo(form) }
    }
    if (error instanceof ProductLinkError || error instanceof PieceError) {
      return { ok: false, errors: { link: error.message }, values: echo(form) }
    }
    throw error
  }
}

/** The form itself, for a new piece and an edit alike. */
export async function submitPiece(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parsePieceForm(form)
  if (!parsed.ok) return { ok: false, errors: parsed.errors, values: echo(form) }
  const pieceId = id(form)
  try {
    if (pieceId) {
      await updatePiece(pieceId, parsed.data)
    } else {
      const origin = parseOrigin(form)
      if (!origin) return { ok: false, message: 'Start again from a photo, a link or by typing it in.', values: echo(form) }
      await createPiece(parsed.data, origin)
    }
  } catch (error) {
    if (error instanceof PieceError) return { ok: false, message: error.message, values: echo(form) }
    throw error
  }
  refreshAll()
  if (pieceId) redirect(`/wardrobe/${pieceId}`)
  // "Save and add another" comes back to a fresh form, camera first.
  redirect(form.get('then') === 'another' ? `/wardrobe/new?added=${Date.now()}` : '/wardrobe')
}

/** A new photo for a piece he already has. Read on our own server only; the form keeps what he saved. */
export async function replacePhoto(_prev: ActionState, form: FormData): Promise<ActionState> {
  const pieceId = id(form)
  const upload = file(form)
  if (!pieceId) return { ok: false, message: 'Unknown piece.' }
  if (!upload) return { ok: false, message: 'Choose a photo first.' }
  try {
    const stored = await storePiecePhoto({ bytes: Buffer.from(await upload.arrayBuffer()), mime: upload.type })
    await attachPhoto(pieceId, stored.id)
  } catch (error) {
    if (error instanceof PhotoError) return { ok: false, message: error.message }
    throw error
  }
  refreshAll()
  return { ok: true }
}

export async function setAsidePiece(form: FormData): Promise<void> {
  const pieceId = id(form)
  if (!pieceId) return
  await setAside(pieceId, form.get('slot_to') === 'retired' ? 'retired' : 'wanted')
  refreshAll()
}

/** Set aside from a row on the Worn page, which leaves at once; this makes it so. */
export async function setAsideRow(input: { piece_id: number; slot_to: 'wanted' | 'retired' }): Promise<{ ok: boolean }> {
  const pieceId = Number(input.piece_id)
  if (!Number.isInteger(pieceId) || pieceId <= 0) return { ok: false }
  try {
    await setAside(pieceId, input.slot_to === 'retired' ? 'retired' : 'wanted')
  } catch {
    return { ok: false }
  }
  refreshAll()
  return { ok: true }
}

export async function restore(form: FormData): Promise<void> {
  const pieceId = id(form)
  if (pieceId) await restorePiece(pieceId)
  refreshAll()
}

export async function removePiece(form: FormData): Promise<void> {
  const pieceId = id(form)
  if (pieceId) {
    const { photoPath } = await deletePiece(pieceId)
    if (photoPath) await removePair(photoPath)
  }
  refreshAll()
  redirect('/wardrobe')
}

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

/** A new set of looks from what he owns. Opus, about a minute; the page waits with a note. */
export async function makeLooks(_prev: ActionState, form: FormData): Promise<ActionState> {
  const note = text(form, 'note')?.slice(0, 300) ?? null
  const kind = text(form, 'kind') === 'gym' ? ('gym' as const) : ('week' as const)
  try {
    const [profile, guide, pieces, wanted, history] = await Promise.all([
      getProfile(),
      getGuide(),
      listPieces(),
      wantedSlots(),
      readHistory(),
    ])
    if (!guide) return { ok: false, message: 'Draft your style guide first. Looks are put together against it.' }
    const ready = kind === 'gym' ? gymReadiness(pieces) : readiness(pieces)
    if (!ready.ready) {
      const what = ready.missing.join(', ')
      return { ok: false, message: kind === 'gym' ? `Mark ${what} as gym kit first.` : `Add ${what} first.`, values: echo(form) }
    }
    const draft = await draftLooks({ profile, guide, pieces, wanted, history, note, kind })
    if (draft.looks.length === 0) {
      console.warn(JSON.stringify({ event: 'looks.none_kept', proposed: draft.proposed, usd: draft.usd }))
      return { ok: false, message: 'None of the looks Claude made held together. Try again.', values: echo(form) }
    }
    const { date, weather } = wellingtonToday()
    const active = pieces.filter((piece) => !piece.set_aside_at).length
    await saveSet(draft, { note, pieces: active, date, weather, kind })
  } catch (error) {
    if (error instanceof GenerationError) {
      console.warn(JSON.stringify({ event: 'looks.failed', message: error.message, cause: error.cause ?? null }))
      return { ok: false, message: error.message, values: echo(form) }
    }
    throw error
  }
  refreshAll()
  return { ok: true }
}

/**
 * A few looks that each wear one piece, from the rest of what he owns, made
 * on a tap on its page. Opus, about a minute, like a set of looks; the page
 * waits with a note and shows them under the button.
 */
export async function makePieceLooks(_prev: ActionState, form: FormData): Promise<ActionState> {
  const pieceId = id(form)
  if (!pieceId) return { ok: false, message: 'Unknown piece.' }
  const note = text(form, 'note')?.slice(0, 300) ?? null
  try {
    const [profile, guide, pieces, wanted, history] = await Promise.all([
      getProfile(),
      getGuide(),
      listPieces(),
      wantedSlots(),
      readHistory(),
    ])
    if (!guide) return { ok: false, message: 'Draft your style guide first. Looks are put together against it.' }
    const piece = pieces.find((one) => one.id === pieceId)
    if (!piece) return { ok: false, message: 'This piece is no longer in your wardrobe.' }
    if (piece.set_aside_at) return { ok: false, message: 'This piece is set aside. Put it back in the wardrobe first.' }
    if (dressable([piece]).length === 0) return { ok: false, message: 'Say what kind of piece it is first.', values: echo(form) }
    const ready = readinessAround(piece, pieces)
    if (!ready.ready) {
      const what = ready.missing.join(', ')
      return { ok: false, message: ready.gym ? `Mark ${what} as gym kit first.` : `Add ${what} first.`, values: echo(form) }
    }
    const draft = await draftLooks({ profile, guide, pieces, wanted, history, note, around: piece })
    if (draft.looks.length === 0) {
      console.warn(JSON.stringify({ event: 'looks.piece_none_kept', piece: piece.id, proposed: draft.proposed, usd: draft.usd }))
      return { ok: false, message: 'None of the looks Claude made held together. Try again.', values: echo(form) }
    }
    const { date, weather } = wellingtonToday()
    const active = pieces.filter((one) => !one.set_aside_at).length
    await saveSet(draft, { note, pieces: active, date, weather, kind: piece.worn_for === 'gym' ? 'gym' : 'week', pieceId: piece.id })
  } catch (error) {
    if (error instanceof GenerationError) {
      console.warn(JSON.stringify({ event: 'looks.piece_failed', piece: pieceId, message: error.message, cause: error.cause ?? null }))
      return { ok: false, message: error.message, values: echo(form) }
    }
    throw error
  }
  refreshAll()
  return { ok: true }
}

/** Save, un-save, dismiss with a reason, wore it. The card shows it at once; this makes it so. */
export async function lookAction(input: LookAction): Promise<{ ok: boolean }> {
  try {
    await actOnLook(input)
  } catch {
    return { ok: false }
  }
  refreshAll()
  return { ok: true }
}

/**
 * A look with pieces swapped or removed, remade by Opus around the rest (ten
 * to thirty seconds; the card waits). The remake takes the old look's place;
 * when it is the day's option on show, its picture is drawn after the response.
 */
export async function remakeLook(input: RemakeAsk): Promise<{ ok: true } | { ok: false; message: string }> {
  const started = await startRemake(input)
  if (!started.ok) return started
  const done = await runRemake(started.id)
  refreshAll()
  if (!done.ok) return done
  if (done.onShow) {
    const imageId = await startLookImage(done.lookId)
    if (imageId !== null) {
      after(async () => {
        await makeLookImage(imageId)
      })
    }
  }
  return { ok: true }
}
