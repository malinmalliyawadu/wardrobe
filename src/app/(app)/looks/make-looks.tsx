'use client'

import { useActionState } from 'react'

import { Field, FormMessage, PendingNote, SubmitButton, TextInput, withEcho } from '@/components/form'

import { makeLooks } from './actions'

/** Six new looks on a tap, with an optional word on what they are for. */
export function MakeLooks({ first }: { first: boolean }) {
  const [state, action] = useActionState(makeLooks, null)
  const v = withEcho({ note: '' }, state?.values)
  return (
    <form action={action} className="space-y-5" key={state?.values ? JSON.stringify(state.values) : 'blank'}>
      <Field label="Anything in mind?" name="note" hint="Optional. A wedding on Saturday, a cold week, more colour.">
        <TextInput name="note" defaultValue={v.note} />
      </Field>
      <div className="space-y-3">
        <SubmitButton pending="Putting looks together">{first ? 'Make my first looks' : 'Make new looks'}</SubmitButton>
        <PendingNote>Opus is putting six looks together from your pieces. A minute or two.</PendingNote>
        <FormMessage message={state?.message} />
      </div>
    </form>
  )
}
