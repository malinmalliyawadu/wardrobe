'use client'

import { useActionState, useState } from 'react'

import { dressAgain } from '@/app/day-actions'
import { Field, FormMessage, SubmitButton, TextInput, withEcho } from '@/components/form'

/**
 * A new outfit for the day, with what is on. Folded away behind one button
 * until he wants it; open from the start when the last attempt failed.
 */
export function DressAgain({ when, open = false }: { when: 'today' | 'tomorrow'; open?: boolean }) {
  const [state, action] = useActionState(dressAgain, null)
  const [shown, setShown] = useState(open)
  const v = withEcho({ day_note: '' }, state?.values)

  if (!shown) {
    return (
      <button type="button" className="btn btn-quiet btn-small" onClick={() => setShown(true)}>
        Dress me again
      </button>
    )
  }

  return (
    <form action={action} className="tray space-y-4" key={state?.values ? JSON.stringify(state.values) : 'blank'}>
      <Field label={`What is on ${when}?`} name="day_note" hint="Optional. Dinner out tonight, a long walk, a client meeting.">
        <TextInput name="day_note" defaultValue={v.day_note} />
      </Field>
      <div className="space-y-3">
        <SubmitButton pending="Starting" variant={open ? 'primary' : 'quiet'}>
          {open ? 'Try again' : 'Dress me again'}
        </SubmitButton>
        <FormMessage message={state?.message} />
      </div>
    </form>
  )
}

/**
 * The same new outfit, offered where a training day's gym fit is missing: a
 * direct button rather than the folded line, since the gym section names it.
 */
export function DressForGym() {
  const [state, action] = useActionState(dressAgain, null)
  return (
    <form action={action} className="mt-4 space-y-3">
      <SubmitButton pending="Starting" variant="quiet" size="small">
        Dress me again
      </SubmitButton>
      <FormMessage message={state?.message} />
    </form>
  )
}
