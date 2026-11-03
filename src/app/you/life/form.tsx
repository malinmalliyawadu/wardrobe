'use client'

import { useActionState } from 'react'

import { Field, FormMessage, NumberInput, Select, SubmitButton, TextArea, withEcho } from '@/components/form'
import type { Life } from '@/lib/profile'

import { submitLife } from '../actions'

export function LifeForm({ life }: { life: Partial<Life> }) {
  const [state, action] = useActionState(submitLife, null)
  const e = state?.errors ?? {}
  const v = withEcho(
    { office: life.office, gym: life.gym, running: life.running, evenings_out: life.evenings_out, travel: life.travel, notes: life.notes },
    state?.values,
  )

  return (
    <form action={action} className="mt-8">
      <h2 className="text-sm font-medium text-ink-2">Days a week</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-5">
        <Field label="Office or client site" name="office" error={e.office}>
          <NumberInput name="office" defaultValue={v.office} error={e.office} />
        </Field>
        <Field label="Gym" name="gym" error={e.gym}>
          <NumberInput name="gym" defaultValue={v.gym} error={e.gym} />
        </Field>
        <Field label="Running" name="running" error={e.running}>
          <NumberInput name="running" defaultValue={v.running} error={e.running} />
        </Field>
        <Field label="Evenings out" name="evenings_out" error={e.evenings_out}>
          <NumberInput name="evenings_out" defaultValue={v.evenings_out} error={e.evenings_out} />
        </Field>
      </div>

      <div className="mt-8 space-y-5">
        <Field label="Travel" name="travel" error={e.travel}>
          <Select
            name="travel"
            defaultValue={v.travel}
            options={[
              { value: 'rarely', label: 'Rarely' },
              { value: 'a_few_times_a_year', label: 'A few times a year' },
              { value: 'monthly', label: 'Monthly or more' },
            ]}
            error={e.travel}
          />
        </Field>
        <Field label="Anything else" name="notes" error={e.notes} hint="Dress codes, a bike commute, a wedding coming up.">
          <TextArea name="notes" defaultValue={v.notes} error={e.notes} />
        </Field>
      </div>

      <div className="mt-10 space-y-4">
        <FormMessage message={state?.message} />
        <SubmitButton pending="Saving">Save your week</SubmitButton>
      </div>
    </form>
  )
}
