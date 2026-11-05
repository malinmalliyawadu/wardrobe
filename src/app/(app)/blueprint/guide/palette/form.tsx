'use client'

import { useActionState, useState, type CSSProperties } from 'react'

import { Field, FormMessage, Select, SubmitButton, TextArea, withEcho } from '@/components/form'
import { label } from '@/lib/profile-values'
import type { Palette } from '@/lib/style-guide'
import { METALS, normaliseHex } from '@/lib/wardrobe-values'

import { submitPalette } from '../../actions'
import { AddRow, MiniField, RemoveRow, fromEcho, keyed, rowInput, useRows, type Keyed } from '../rows'

type ColourRow = { hex: string; name: string; note: string }

function rowsFor(
  echo: Record<string, string> | undefined,
  prefix: string,
  noteField: 'use' | 'why',
  saved: { hex: string; name: string; use?: string; why?: string }[],
): Keyed<ColourRow>[] {
  if (echo) {
    return fromEcho(echo, prefix, ['hex', 'name', noteField] as const).map(({ key, value }) => ({
      key,
      value: { hex: value.hex, name: value.name, note: value[noteField] },
    }))
  }
  return keyed(saved.map((colour) => ({ hex: colour.hex, name: colour.name, note: colour[noteField] ?? '' })))
}

export function PaletteForm({ palette }: { palette: Palette }) {
  const [state, action] = useActionState(submitPalette, null)
  const errors = state?.errors ?? {}
  const v = withEcho({ summary: palette.summary, metal: palette.metal, metal_why: palette.metal_why }, state?.values)
  const remount = state?.values ? JSON.stringify(state.values) : 'saved'

  return (
    <form action={action} className="mt-8 max-w-2xl space-y-10" key={remount}>
      <Field label="How your palette works" name="summary" error={errors.summary}>
        <TextArea name="summary" defaultValue={v.summary} rows={7} error={errors.summary} />
      </Field>

      <ColourList
        title="Best colours"
        hint="The first five are the swatches beside the wordmark."
        prefix="best"
        noteField="use"
        noteLabel="Where it works"
        initial={rowsFor(state?.values, 'best', 'use', palette.best)}
        errors={errors}
      />
      <ColourList
        title="Best neutrals"
        prefix="neutrals"
        noteField="use"
        noteLabel="Where it works"
        initial={rowsFor(state?.values, 'neutrals', 'use', palette.neutrals)}
        errors={errors}
      />
      <ColourList
        title="Keep away from your face"
        prefix="avoid"
        noteField="why"
        noteLabel="Why"
        initial={rowsFor(state?.values, 'avoid', 'why', palette.avoid)}
        errors={errors}
      />

      <div className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="Metal" name="metal" error={errors.metal}>
          <Select
            name="metal"
            defaultValue={v.metal}
            options={METALS.map((metal) => ({ value: metal, label: label(metal) }))}
            error={errors.metal}
          />
        </Field>
        <Field label="Why that metal" name="metal_why" error={errors.metal_why}>
          <TextArea name="metal_why" defaultValue={v.metal_why} rows={2} error={errors.metal_why} />
        </Field>
      </div>

      <div className="space-y-4">
        <FormMessage message={state?.message ?? (errors.best ? errors.best : Object.keys(errors).length ? 'Check the rows marked above.' : undefined)} />
        <SubmitButton pending="Saving">Save palette</SubmitButton>
      </div>
    </form>
  )
}

function ColourList({
  title,
  hint,
  prefix,
  noteField,
  noteLabel,
  initial,
  errors,
}: {
  title: string
  hint?: string
  prefix: string
  noteField: 'use' | 'why'
  noteLabel: string
  initial: Keyed<ColourRow>[]
  errors: Record<string, string>
}) {
  const { rows, add, remove } = useRows(initial, () => ({ hex: '', name: '', note: '' }))
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-2">{title}</legend>
      {hint ? <p className="mt-1 text-sm text-ink-3">{hint}</p> : null}
      <ul className="mt-1 divide-y divide-line">
        {rows.map((row, index) => (
          <li key={row.key} className="py-4">
            <ColourEditor
              prefix={prefix}
              rowKey={row.key}
              initial={row.value}
              noteField={noteField}
              noteLabel={noteLabel}
              errors={errors}
              position={index + 1}
              onRemove={() => remove(row.key)}
            />
          </li>
        ))}
      </ul>
      <AddRow onClick={add}>Add a colour</AddRow>
    </fieldset>
  )
}

/**
 * One colour. The swatch is the native colour picker, so on a phone a tap
 * opens the system wheel; the hex field beside it is the exact value, and the
 * two stay in step.
 */
function ColourEditor({
  prefix,
  rowKey,
  initial,
  noteField,
  noteLabel,
  errors,
  position,
  onRemove,
}: {
  prefix: string
  rowKey: number
  initial: ColourRow
  noteField: 'use' | 'why'
  noteLabel: string
  errors: Record<string, string>
  position: number
  onRemove: () => void
}) {
  const [hex, setHex] = useState(initial.hex)
  const valid = normaliseHex(hex)
  const hexField = rowInput(prefix, rowKey, 'hex', errors)
  const nameField = rowInput(prefix, rowKey, 'name', errors)
  const noteInput = rowInput(prefix, rowKey, noteField, errors)

  return (
    <div className="flex gap-3">
      <div className="flex w-14 shrink-0 flex-col items-center gap-2">
        <label
          className="swatch pressable relative mt-6 block h-[4.5rem] w-14 cursor-pointer overflow-hidden rounded-[var(--radius-tile)]"
          style={{ '--swatch': valid ?? 'transparent' } as CSSProperties}
        >
          <span className="sr-only">Pick colour {position}</span>
          <input
            type="color"
            value={valid ?? '#000000'}
            onChange={(event) => setHex(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <RemoveRow label={`Remove colour ${position}`} onClick={onRemove} />
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-[6.75rem_minmax(0,1fr)] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <MiniField label="Hex" htmlFor={hexField.props.id} error={hexField.error}>
          <input
            {...hexField.props}
            type="text"
            value={hex}
            onChange={(event) => setHex(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="field tabular-nums"
          />
        </MiniField>
        <MiniField label="Name" htmlFor={nameField.props.id} error={nameField.error}>
          <input {...nameField.props} type="text" defaultValue={initial.name} className="field" />
        </MiniField>
        <div className="col-span-2">
          <MiniField label={noteLabel} htmlFor={noteInput.props.id} error={noteInput.error}>
            <input {...noteInput.props} type="text" defaultValue={initial.note} className="field" />
          </MiniField>
        </div>
      </div>
    </div>
  )
}
