'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import type { ActionState } from '@/lib/action-state'
import { SESSION_COOKIE, appPassword, issueSession, passwordMatches, safeNext, sessionCookieOptions } from '@/lib/auth'

/** A wrong guess waits this long, which makes guessing slow and costs Malin nothing. */
const WRONG_PASSWORD_DELAY_MS = 800

export async function signIn(_previous: ActionState, form: FormData): Promise<ActionState> {
  const next = safeNext(String(form.get('next') ?? '/'))
  const password = appPassword()
  if (password === null) redirect(next)

  const attempt = String(form.get('password') ?? '')
  if (!(await passwordMatches(attempt, password))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS))
    return { ok: false, errors: { password: attempt ? 'That is not the password.' : 'Enter the password.' } }
  }

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await issueSession(password), sessionCookieOptions())
  redirect(next)
}
