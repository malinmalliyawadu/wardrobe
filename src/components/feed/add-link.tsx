'use client'

import { useActionState } from 'react'

import { addLinkToSaved } from '@/app/feed-actions'
import { SubmitButton } from '@/components/form'

/**
 * Paste a product link from any of the shops and it joins Saved, found or not.
 * The shop is read there and then, so the button says so while it waits.
 * Keyed on the last success by the caller, so the field clears after an add.
 */
export function AddLink({ slots }: { slots: { id: number; name: string }[] }) {
  const [state, action] = useActionState(addLinkToSaved, null)
  const error = state?.errors?.link
  const values = state?.ok ? undefined : state?.values

  return (
    <form action={action} className="mt-5">
      <label htmlFor="saved-link" className="mb-1.5 block text-sm font-medium text-ink-2">
        Add a product you want
      </label>
      <input
        id="saved-link"
        name="link"
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        placeholder="Paste a link from one of the shops"
        defaultValue={values?.link ?? ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'saved-link-error' : undefined}
        className="field"
      />
      {error ? (
        <p id="saved-link-error" role="alert" className="mt-1.5 text-sm text-alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="saved-slot" className="sr-only">
          For which slot
        </label>
        <select id="saved-slot" name="slot_id" defaultValue={values?.slot_id ?? ''} className="field sm:flex-1">
          <option value="">Not for a slot</option>
          {slots.map((slot) => (
            <option key={slot.id} value={slot.id}>
              For: {slot.name}
            </option>
          ))}
        </select>
        <SubmitButton pending="Reading the shop" variant="quiet" className="sm:shrink-0">
          Add to saved
        </SubmitButton>
      </div>
    </form>
  )
}
