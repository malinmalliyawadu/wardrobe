'use client'

import { useActionState } from 'react'

import { FormMessage, SubmitButton } from '@/components/form'
import { FITS, label } from '@/lib/profile-values'
import type { FitEntry } from '@/lib/style-guide'
import { GARMENT_LABELS, GARMENT_TYPES } from '@/lib/wardrobe-values'

import { submitFits } from '../../actions'
import { AddRow, MiniField, RemoveRow, fromEcho, keyed, rowInput, useRows, type Keyed } from '../rows'

type FitRow = { garment: string; note: string; fits: string[] }

const FIELDS = ['garment', 'note', ...FITS] as const

export function FitsForm({ fits }: { fits: FitEntry[] }) {
  const [state, action] = useActionState(submitFits, null)
  const errors = state?.errors ?? {}
  const initial: Keyed<FitRow>[] = state?.values
    ? fromEcho(state.values, 'fits', FIELDS).map(({ key, value }) => ({
        key,
        value: { garment: value.garment, note: value.note, fits: FITS.filter((fit) => value[fit]) },
      }))
    : keyed(fits.map((entry) => ({ garment: entry.garment, note: entry.note, fits: entry.fits })))

  return (
    <form action={action} className="mt-6 max-w-2xl space-y-10" key={state?.values ? JSON.stringify(state.values) : 'saved'}>
      <Rows initial={initial} errors={errors} />
      <div className="space-y-4">
        <FormMessage message={state?.message ?? (Object.keys(errors).length ? 'Check the rows marked above.' : undefined)} />
        <SubmitButton pending="Saving">Save fits</SubmitButton>
      </div>
    </form>
  )
}

function Rows({ initial, errors }: { initial: Keyed<FitRow>[]; errors: Record<string, string> }) {
  const { rows, add, remove } = useRows(initial, () => ({ garment: '', note: '', fits: [] }))
  return (
    <fieldset>
      <legend className="sr-only">Fit by garment</legend>
      <ul className="divide-y divide-line">
        {rows.map((row, index) => {
          const garment = rowInput('fits', row.key, 'garment', errors)
          const note = rowInput('fits', row.key, 'note', errors)
          return (
            <li key={row.key} className="flex gap-3 py-4">
              <div className="grid min-w-0 flex-1 gap-3">
                <MiniField label="Garment" htmlFor={garment.props.id} error={garment.error}>
                  <select {...garment.props} defaultValue={row.value.garment} className="field">
                    <option value="">Choose one</option>
                    {GARMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {GARMENT_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </MiniField>
                <div role="group" aria-label={`Fits for row ${index + 1}`} className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
                  {FITS.map((fit) => (
                    <label key={fit} className="segment pressable px-1 text-[0.875rem] sm:px-4 sm:text-[0.9375rem]">
                      <input
                        type="checkbox"
                        name={`fits.${row.key}.${fit}`}
                        value="on"
                        defaultChecked={row.value.fits.includes(fit)}
                        className="sr-only"
                      />
                      {label(fit)}
                    </label>
                  ))}
                </div>
                <MiniField label="What to look for" htmlFor={note.props.id} error={note.error}>
                  <textarea {...note.props} defaultValue={row.value.note} rows={2} className="field" />
                </MiniField>
              </div>
              <RemoveRow label={`Remove row ${index + 1}`} onClick={() => remove(row.key)} />
            </li>
          )
        })}
      </ul>
      <AddRow onClick={add}>Add a garment</AddRow>
    </fieldset>
  )
}
