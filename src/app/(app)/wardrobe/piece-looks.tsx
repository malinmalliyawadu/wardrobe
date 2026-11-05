'use client'

import { useActionState } from 'react'

import { Field, FormMessage, PendingNote, SubmitButton, TextInput, withEcho } from '@/components/form'

import { makePieceLooks } from './actions'

/**
 * A few looks that each wear this piece, on a tap, with an optional word on
 * what they are for. The looks land under the form when Opus is done.
 */
export function MakePieceLooks({ id, again }: { id: number; again: boolean }) {
  const [state, action] = useActionState(makePieceLooks, null)
  const v = withEcho({ note: '' }, state?.values)
  return (
    <form action={action} className="max-w-2xl space-y-5" key={state?.values ? JSON.stringify(state.values) : 'blank'}>
      <input type="hidden" name="id" value={id} />
      <Field label="Anything in mind?" name="note" hint="Optional. For the office, a cold day, something to wear it with.">
        <TextInput name="note" defaultValue={v.note} />
      </Field>
      <div className="space-y-3">
        <SubmitButton pending="Putting looks together" variant="quiet">
          {again ? 'Make new looks with it' : 'Make looks with it'}
        </SubmitButton>
        <PendingNote>Opus is putting a few looks together around it. About a minute.</PendingNote>
        <FormMessage message={state?.message} />
      </div>
    </form>
  )
}
