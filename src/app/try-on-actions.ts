'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'

import type { ActionState } from '@/lib/action-state'
import {
  MAX_OUTFIT_PIECES,
  makeTryOn,
  startAgain,
  startLookTryOn,
  startOutfitTryOn,
  startStatementTryOn,
  startTryOn,
  type Started,
} from '@/lib/try-on'

/*
 * "See it on me", on a find, on a look, on a statement piece with the pieces
 * it wears with, and on pieces he chose on the On me page. Each records the
 * request and answers at once; the image is made after the response, because
 * it takes up to two minutes, and the card asks /photos/try-ons/:id/status
 * until it is ready. On a card nothing is revalidated: the card holds the state, and the
 * next render reads it from the row. From the On me page the new picture is
 * a row on that page, so it is revalidated and shown there, in the making.
 *
 * A picture of the same outfit already kept is the answer to a first tap
 * (startTryOn and the rest say `reused`): nothing is made, the card shows it,
 * and the chooser opens it. Only "Make it again" (`again`) makes another.
 */

const Id = z.number().int().positive()

function makeAfter(started: Started): Started {
  if (started.ok && !started.reused) {
    after(async () => {
      await makeTryOn(started.id)
    })
  }
  return started
}

export async function seeItOnMe(productId: number, again: boolean = false): Promise<Started> {
  const id = Id.safeParse(productId)
  if (!id.success) return { ok: false, message: 'That find could not be read.' }
  return makeAfter(await startTryOn(id.data, undefined, { again: again === true }))
}

export async function seeLookOnMe(lookId: number, again: boolean = false): Promise<Started> {
  const id = Id.safeParse(lookId)
  if (!id.success) return { ok: false, message: 'That look could not be read.' }
  return makeAfter(await startLookTryOn(id.data, undefined, { again: again === true }))
}

/** A statement piece worn with the pieces of his its card names. */
export async function seeStatementOutfitOnMe(productId: number, pieceIds: number[], again: boolean = false): Promise<Started> {
  const id = Id.safeParse(productId)
  const pieces = z.array(Id).min(1).max(MAX_OUTFIT_PIECES - 1).safeParse(pieceIds)
  if (!id.success || !pieces.success) return { ok: false, message: 'That outfit could not be read.' }
  return makeAfter(await startStatementTryOn(id.data, pieces.data, undefined, { again: again === true }))
}

/** "p12" is wardrobe piece 12, "f34" saved find 34. */
const ChoiceKey = z.string().regex(/^[pf][1-9]\d{0,15}$/)

/** The On me page's form: the pieces and saved finds ticked. */
export async function tryChosenOn(_state: ActionState, form: FormData): Promise<ActionState> {
  const keys = z.array(ChoiceKey).safeParse(form.getAll('choice'))
  if (!keys.success) return { ok: false, message: 'That choice could not be read. Choose again.' }
  if (keys.data.length === 0) return { ok: false, message: 'Choose at least one piece.' }
  if (keys.data.length > MAX_OUTFIT_PIECES) return { ok: false, message: `Choose up to ${MAX_OUTFIT_PIECES} pieces.` }
  const ids = (prefix: string) => keys.data.filter((key) => key.startsWith(prefix)).map((key) => Number(key.slice(1)))

  const started = makeAfter(await startOutfitTryOn({ piece_ids: ids('p'), product_ids: ids('f') }))
  if (!started.ok) return { ok: false, message: started.message }
  // Those pieces were already put on him: open that picture rather than make another.
  if (started.reused) redirect(`/wardrobe/on-me/${started.id}`)
  revalidatePath('/', 'layout')
  redirect('/wardrobe/on-me')
}

/** "Make it again" on a picture's own page: the same find, look or pieces. */
export async function makeItAgain(tryOnId: number): Promise<Started> {
  const id = Id.safeParse(tryOnId)
  if (!id.success) return { ok: false, message: 'That picture could not be read.' }
  const started = makeAfter(await startAgain(id.data))
  if (started.ok) revalidatePath('/', 'layout')
  return started
}
