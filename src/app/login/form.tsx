'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/form'

import { signIn } from './actions'

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, null)
  const error = state?.errors?.password
  return (
    <form action={action} className="mt-8 grid gap-4">
      <input type="hidden" name="next" value={next} />
      {/* A username field nobody sees, so password managers file the entry under something. */}
      <input type="text" name="username" autoComplete="username" defaultValue="malin" hidden readOnly />
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink-2">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'password-error' : undefined}
          className="field"
        />
        {/* Always there, so a wrong password does not shift the centred form. */}
        <p id="password-error" role="alert" className="mt-1.5 min-h-5 text-sm text-alert">
          {error}
        </p>
      </div>
      <SubmitButton pending="Signing in" className="w-full">
        Sign in
      </SubmitButton>
    </form>
  )
}
