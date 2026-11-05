'use client'

import { useActionState } from 'react'

import { Field, FormMessage, NumberInput, Select, SubmitButton, TextArea, withEcho } from '@/components/form'
import type { Life } from '@/lib/profile'
import { WEEKDAY_SHORT, WEEKDAYS } from '@/lib/profile-values'

import { submitLife } from '../actions'

export function LifeForm({ life }: { life: Partial<Life> }) {
  const [state, action] = useActionState(submitLife, null)
  const e = state?.errors ?? {}
  const v = withEcho(
    {
      office: life.office,
      gym_days: life.gym_days?.join(',') ?? '',
      running: life.running,
      evenings_out: life.evenings_out,
      travel: life.travel,
      notes: life.notes,
    },
    state?.values,
  )
  const gymDays = new Set(String(v.gym_days ?? '').split(','))
  // Before the days could be chosen the week said only how many.
  const countOnly = !life.gym_days?.length && life.gym ? life.gym : null

  return (
    <form action={action} className="mt-8 max-w-2xl" key={state?.values ? JSON.stringify(state.values) : 'saved'}>
      <h2 className="caption text-ink-2">Days a week</h2>
      <div className="mt-3 grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <Field label="Office or client site" name="office" error={e.office}>
          <NumberInput name="office" defaultValue={v.office} error={e.office} />
        </Field>
        <Field label="Evenings out" name="evenings_out" error={e.evenings_out}>
          <NumberInput name="evenings_out" defaultValue={v.evenings_out} error={e.evenings_out} />
        </Field>
        <Field label="Running" name="running" error={e.running}>
          <NumberInput name="running" defaultValue={v.running} error={e.running} />
        </Field>
      </div>

      <fieldset className="mt-10">
        <legend className="caption text-ink-2">Gym</legend>
        {countOnly ? <input type="hidden" name="gym" value={countOnly} /> : null}
        <p className="mt-1 mb-3 text-sm text-ink-3">
          {countOnly
            ? `You said ${countOnly} ${countOnly === 1 ? 'day' : 'days'} a week. Tap which, and Today adds a gym fit on them.`
            : 'The days you train. On them, Today adds a gym fit to the outfit of the day.'}
        </p>
        <div className="grid max-w-md grid-cols-7 gap-1.5">
          {WEEKDAYS.map((day) => (
            <label key={day} className="segment pressable px-0">
              <input
                type="checkbox"
                name="gym_days"
                value={day}
                aria-label={day.charAt(0).toUpperCase() + day.slice(1)}
                defaultChecked={gymDays.has(day)}
                className="sr-only"
              />
              {WEEKDAY_SHORT[day]}
            </label>
          ))}
        </div>
        {e.gym_days ? (
          <p role="alert" className="mt-1.5 text-sm text-alert">
            {e.gym_days}
          </p>
        ) : null}
      </fieldset>

      <div className="mt-10 space-y-5">
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
