'use client'

import { useActionState } from 'react'

import { SubmitButton, withEcho } from '@/components/form'

import { search } from './actions'

/**
 * One line for what he is after. A search field so the phone's keyboard says
 * "search"; the error, when there is one, is the only line under it.
 */
export function SearchForm({ hint }: { hint: string }) {
  const [state, action] = useActionState(search, null)
  const v = withEcho({ request: '' }, state?.values)
  const error = state?.errors?.request
  return (
    <form action={action} role="search" className="mt-8 max-w-2xl" key={state?.values ? JSON.stringify(state.values) : 'blank'}>
      <label htmlFor="request" className="mb-1.5 block text-sm font-medium text-ink-2">
        What are you after?
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="request"
          name="request"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          maxLength={200}
          defaultValue={v.request ?? ''}
          placeholder="A navy overshirt under $300"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'request-error' : 'request-hint'}
          className="field sm:flex-1"
        />
        <SubmitButton pending="Starting" className="sm:shrink-0">
          Search
        </SubmitButton>
      </div>
      {error ? (
        <p id="request-error" role="alert" className="mt-2 text-sm text-alert">
          {error}
        </p>
      ) : (
        <p id="request-hint" className="mt-2 max-w-[48ch] text-sm text-ink-3">
          {hint}
        </p>
      )}
    </form>
  )
}
