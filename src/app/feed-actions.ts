'use server'

import { revalidatePath } from 'next/cache'

import { recordAction, type FeedAction } from '@/lib/feed'

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
