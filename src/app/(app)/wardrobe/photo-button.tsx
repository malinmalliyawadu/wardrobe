'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { FormMessage, Spinner } from '@/components/form'

import { replacePhoto } from './actions'

/** Choosing a file sends it at once. The photo is read on our own server only. */
export function PhotoButton({ id, hasPhoto }: { id: number; hasPhoto: boolean }) {
  const [state, action] = useActionState(replacePhoto, null)
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Choose label={hasPhoto ? 'Replace the photo' : 'Add a photo'} />
      {state?.message ? (
        <div className="mt-2">
          <FormMessage message={state.message} />
        </div>
      ) : null}
    </form>
  )
}

function Choose({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <label className={`text-button -ml-2 cursor-pointer ${pending ? 'cursor-progress' : ''}`}>
      <input
        type="file"
        name="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        disabled={pending}
        onChange={(event) => {
          if (event.target.files?.length) event.target.form?.requestSubmit()
        }}
      />
      {pending ? (
        <>
          <Spinner />
          Adding
        </>
      ) : (
        label
      )}
    </label>
  )
}
