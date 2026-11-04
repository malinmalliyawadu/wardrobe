'use server'

import { after } from 'next/server'
import { z } from 'zod'

import { makeTryOn, startLookTryOn, startTryOn, type Started } from '@/lib/try-on'

/*
 * "See it on me", on a find and on a look. Each records the request and
 * answers at once; the image is made after the response, because it takes up
 * to two minutes, and the card asks /photos/try-ons/:id/status until it is
 * ready. Nothing is revalidated: the card holds the state, and the next render
 * reads it from the row.
 */

const Id = z.number().int().positive()

function makeAfter(started: Started): Started {
  if (started.ok) {
    after(async () => {
      await makeTryOn(started.id)
    })
  }
  return started
}

export async function seeItOnMe(productId: number): Promise<Started> {
  const id = Id.safeParse(productId)
  if (!id.success) return { ok: false, message: 'That find could not be read.' }
  return makeAfter(await startTryOn(id.data))
}

export async function seeLookOnMe(lookId: number): Promise<Started> {
  const id = Id.safeParse(lookId)
  if (!id.success) return { ok: false, message: 'That look could not be read.' }
  return makeAfter(await startLookTryOn(id.data))
}
