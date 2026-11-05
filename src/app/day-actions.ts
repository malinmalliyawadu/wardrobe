'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'

import { echo, type ActionState } from '@/lib/action-state'
import { runDay, showNext, showOption, startDay } from '@/lib/day-outfit'
import { text } from '@/lib/form-parse'
import { makeLookImage, startLookImage } from '@/lib/look-image'

/*
 * The outfit of the day on Today. Opening Today on a day with no outfit
 * starts one; "Dress me again" starts another with what he says is on;
 * "Another" turns to the next option. The outfit is made after the response
 * (Opus, about a minute) and the card refreshes until it is there. The
 * option on show gets a picture (look-image.ts), drawn after the response.
 */

/** The first opening of Today on a day: makes its outfit, unless it has one or one is in the making. */
export async function startDayOutfit(): Promise<{ ok: boolean; message?: string }> {
  const started = await startDay()
  if (!started.ok) return { ok: false, message: started.message }
  after(async () => {
    await runDay(started.id)
  })
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Another outfit for the day, with what is on: "dinner out tonight". */
export async function dressAgain(_prev: ActionState, form: FormData): Promise<ActionState> {
  const started = await startDay({ note: text(form, 'day_note'), again: true })
  if (!started.ok) return { ok: false, message: started.message, values: echo(form) }
  after(async () => {
    await runDay(started.id)
  })
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** The next of the day's options, and its picture if it has none yet. */
export async function nextOption(dayId: number): Promise<{ ok: boolean }> {
  if (!Number.isInteger(dayId) || dayId <= 0) return { ok: false }
  try {
    const lookId = await showNext(dayId)
    if (lookId !== null) await draw(lookId)
  } catch {
    return { ok: false }
  }
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** The option he swiped to, and its picture if it has none yet. */
export async function turnTo(dayId: number, index: number): Promise<{ ok: boolean }> {
  if (!Number.isInteger(dayId) || dayId <= 0 || !Number.isInteger(index) || index < 0) return { ok: false }
  try {
    const lookId = await showOption(dayId, index)
    if (lookId !== null) await draw(lookId)
  } catch {
    return { ok: false }
  }
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Draws the picture of a look again, after one failed. */
export async function drawLook(lookId: number): Promise<{ ok: boolean }> {
  if (!Number.isInteger(lookId) || lookId <= 0) return { ok: false }
  await draw(lookId)
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Records the picture now, so the next render shows it in the making, and draws it after the response. */
async function draw(lookId: number): Promise<void> {
  const id = await startLookImage(lookId)
  if (id === null) return
  after(async () => {
    await makeLookImage(id)
  })
}
