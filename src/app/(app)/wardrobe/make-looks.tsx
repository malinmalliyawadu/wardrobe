'use client'

import { useActionState, useState } from 'react'

import { Field, FormMessage, PendingNote, SubmitButton, TextInput, withEcho } from '@/components/form'
import type { LookKind } from '@/lib/looks'

import { makeLooks } from './actions'

const KIND_LABELS: Record<LookKind, string> = { week: 'Your week', gym: 'Gym fits' }

/**
 * Six new looks on a tap, with an optional word on what they are for. When
 * his gym kit makes a gym fit, he chooses between a set for his week (with a
 * gym fit or two in it, if he trains) and a set of gym fits only.
 */
export function MakeLooks({ first, kinds }: { first: boolean; kinds: LookKind[] }) {
  const [state, action] = useActionState(makeLooks, null)
  const v = withEcho({ note: '', kind: kinds[0] ?? 'week' }, state?.values)
  const [kind, setKind] = useState(v.kind)
  const gym = kind === 'gym'
  return (
    <form action={action} className="max-w-2xl space-y-5" key={state?.values ? JSON.stringify(state.values) : 'blank'}>
      {kinds.length > 1 ? (
        <fieldset>
          <legend className="mb-3 text-sm font-medium text-ink-2">For</legend>
          <div className="flex flex-wrap gap-2">
            {kinds.map((option) => (
              <label key={option} className="segment pressable">
                <input
                  type="radio"
                  name="kind"
                  value={option}
                  defaultChecked={v.kind === option}
                  onChange={() => setKind(option)}
                  className="sr-only"
                />
                {KIND_LABELS[option]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="kind" value={kind} />
      )}
      <Field
        label="Anything in mind?"
        name="note"
        hint={gym ? 'Optional. Leg day, a cold morning session, more colour.' : 'Optional. A wedding on Saturday, a cold week, more colour.'}
      >
        <TextInput name="note" defaultValue={v.note} />
      </Field>
      <div className="space-y-3">
        <SubmitButton pending="Putting looks together">
          {gym ? 'Make gym fits' : first ? 'Make my first looks' : 'Make new looks'}
        </SubmitButton>
        <PendingNote>
          {gym
            ? 'Opus is putting gym fits together from your kit. A minute or two.'
            : 'Opus is putting six looks together from your pieces. A minute or two.'}
        </PendingNote>
        <FormMessage message={state?.message} />
      </div>
    </form>
  )
}
