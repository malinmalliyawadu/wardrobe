'use server'

import { after } from 'next/server'
import { z } from 'zod'

import { makeTryOn, startTryOn, type Started } from '@/lib/try-on'

/**
 * "See it on me" on a find. Records the request and answers at once; the image
 * is made after the response, because it takes up to two minutes, and the card
 * asks /photos/try-ons/:id/status until it is ready. Nothing is revalidated:
 * the card holds the state, and the next render of Today reads it from the row.
 */
export async function seeItOnMe(productId: number): Promise<Started> {
  const id = z.number().int().positive().safeParse(productId)
  if (!id.success) return { ok: false, message: 'That find could not be read.' }
  const started = await startTryOn(id.data)
  if (started.ok) {
    after(async () => {
      await makeTryOn(started.id)
    })
  }
  return started
}
