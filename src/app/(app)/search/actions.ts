'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'

import { echo, type ActionState } from '@/lib/action-state'
import { runSearch, startSearch } from '@/lib/search'

/**
 * A search from the Search tab. Records it and opens its page at once; the
 * search itself runs after the response (it takes a minute or so), and the
 * page refreshes until it is done, so leaving loses nothing.
 */
export async function search(_prev: ActionState, form: FormData): Promise<ActionState> {
  const request = form.get('request')
  if (typeof request !== 'string' || request.trim() === '') {
    return { ok: false, errors: { request: 'Say what you are after' }, values: echo(form) }
  }
  const started = await startSearch(request)
  if (!started.ok) return { ok: false, errors: { request: started.message }, values: echo(form) }
  after(async () => {
    await runSearch(started.id)
  })
  revalidatePath('/search')
  redirect(`/search/${started.id}`)
}
