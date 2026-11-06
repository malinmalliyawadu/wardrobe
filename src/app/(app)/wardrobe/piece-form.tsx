'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { Swatch as ColourSwatch } from '@/components/cloth'
import { Field, FormMessage, Select, SubmitButton, TextArea, TextInput, withEcho } from '@/components/form'
import type { OpenSlot } from '@/lib/pieces'
import { FITS, label } from '@/lib/profile-values'
import {
  GARMENT_LABELS,
  PIECE_GARMENT_TYPES,
  WARMTH_LABELS,
  WARMTHS,
  WORN_FOR,
  WORN_FOR_LABELS,
  type GarmentType,
} from '@/lib/wardrobe-values'

import { submitPiece } from './actions'
import type { PieceFormValues, Swatch } from './piece-values'

/**
 * Every field of a piece, for a new one and an edit. The colour is picked
 * from the guide's palette, so the looks speak the palette; a colour read
 * from a photo that is not in it stays on offer as its own swatch. The slot
 * list follows the garment chosen, so a tee can only fill a tee slot. Gym
 * kit is the garment it is (a tank, shorts, trainers) worn for the gym; a
 * piece filed as Activewear before keeps that choice until he names it.
 */
export function PieceForm({
  id,
  origin,
  initial,
  best,
  neutrals,
  slots,
  submitLabel,
  another = false,
}: {
  id?: number
  origin?: { source: string; photo_id: number | null; product_id: number | null }
  initial: PieceFormValues
  best: Swatch[]
  neutrals: Swatch[]
  slots: OpenSlot[]
  submitLabel: string
  /** A new piece can be saved straight into adding the next, for going round the wardrobe with the camera. */
  another?: boolean
}) {
  const [state, action] = useActionState(submitPiece, null)
  const e = state?.errors ?? {}
  const v = withEcho(initial, state?.values)
  const [garment, setGarment] = useState(v.garment_type)
  const known = new Set([...best, ...neutrals].map((swatch) => swatch.hex))
  const own = v.colour_hex && !known.has(v.colour_hex) ? [{ hex: v.colour_hex, name: 'Its own colour' }] : []
  const forGarment = slots.filter((slot) => slot.garment_type === garment || String(slot.id) === v.slot_id)
  const garments: GarmentType[] = initial.garment_type === 'activewear' ? [...PIECE_GARMENT_TYPES, 'activewear'] : PIECE_GARMENT_TYPES

  return (
    <form action={action} className="mt-6 max-w-2xl space-y-7" key={state?.values ? JSON.stringify(state.values) : 'saved'}>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {origin ? (
        <>
          <input type="hidden" name="source" value={origin.source} />
          <input type="hidden" name="photo_id" value={origin.photo_id ?? ''} />
          <input type="hidden" name="product_id" value={origin.product_id ?? ''} />
        </>
      ) : null}

      <Field label="Name" name="name" error={e.name} hint="As you would describe it to a friend.">
        <TextInput name="name" defaultValue={v.name} error={e.name} placeholder="Ink navy merino crewneck" />
      </Field>

      <Field
        label="Garment"
        name="garment_type"
        error={e.garment_type}
        hint={garment === 'activewear' ? 'Say what it is, a tank, shorts, trainers, so it can go in a gym fit.' : undefined}
      >
        <Select
          name="garment_type"
          defaultValue={v.garment_type}
          options={garments.map((type) => ({ value: type, label: GARMENT_LABELS[type] }))}
          placeholder="Choose one"
          error={e.garment_type}
          onChange={setGarment}
        />
      </Field>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">Colour</legend>
        <p className="mb-3 text-sm text-ink-3">The palette colour it is, or close to.</p>
        <SwatchRadios title="Best" swatches={best} chosen={v.colour_hex} />
        <SwatchRadios title="Neutrals" swatches={neutrals} chosen={v.colour_hex} />
        <SwatchRadios title="Not in your palette" swatches={own} chosen={v.colour_hex} />
        <label className="mt-1 flex min-h-11 items-center gap-3 text-[0.9375rem] text-ink-2">
          <input type="radio" name="colour_hex" value="" defaultChecked={!v.colour_hex} className="size-5 accent-[var(--accent)]" />
          No single colour (a print, a stripe)
        </label>
        {e.colour_hex ? (
          <p role="alert" className="mt-1.5 text-sm text-alert">
            {e.colour_hex}
          </p>
        ) : null}
      </fieldset>

      <Field label="Colour in words" name="colour_name" error={e.colour_name}>
        <TextInput name="colour_name" defaultValue={v.colour_name} error={e.colour_name} placeholder="Ink navy" />
      </Field>

      <Field label="Fabric" name="fabric" error={e.fabric}>
        <TextInput name="fabric" defaultValue={v.fabric} error={e.fabric} placeholder="Merino" />
      </Field>

      <Field label="Fit" name="fit" error={e.fit}>
        <Select
          name="fit"
          defaultValue={v.fit}
          options={FITS.map((fit) => ({ value: fit, label: label(fit) }))}
          placeholder="Not a fit garment, or not sure"
          error={e.fit}
        />
      </Field>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">Warmth</legend>
        <p className="mb-3 text-sm text-ink-3">Light for summer, mid for most Wellington days, warm for a southerly.</p>
        <div className="flex flex-wrap gap-2">
          {WARMTHS.map((warmth) => (
            <label key={warmth} className="segment pressable">
              <input type="radio" name="warmth" value={warmth} defaultChecked={v.warmth === warmth} className="sr-only" />
              {WARMTH_LABELS[warmth]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">Worn for</legend>
        <p className="mb-3 text-sm text-ink-3">The gym keeps it to gym fits. Both is for pieces like the trainers you lift in and wear out.</p>
        <div className="flex flex-wrap gap-2">
          {WORN_FOR.map((use) => (
            <label key={use} className="segment pressable">
              <input type="radio" name="worn_for" value={use} defaultChecked={v.worn_for === use} className="sr-only" />
              {WORN_FOR_LABELS[use]}
            </label>
          ))}
        </div>
        {e.worn_for ? (
          <p role="alert" className="mt-1.5 text-sm text-alert">
            {e.worn_for}
          </p>
        ) : null}
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Brand" name="brand" error={e.brand}>
          <TextInput name="brand" defaultValue={v.brand} error={e.brand} />
        </Field>
        <Field label="Size" name="size" error={e.size}>
          <TextInput name="size" defaultValue={v.size} error={e.size} placeholder="M, 32, EU 42" />
        </Field>
      </div>

      <Field
        label="Fills a blueprint slot"
        name="slot_id"
        error={e.slot_id}
        hint={
          garment && forGarment.length === 0
            ? 'No open slot asks for this kind of piece.'
            : 'The slot is marked owned and the finder stops looking for it.'
        }
      >
        <Select
          name="slot_id"
          defaultValue={v.slot_id}
          options={forGarment.map((slot) => ({ value: String(slot.id), label: slot.name }))}
          placeholder="None"
          error={e.slot_id}
        />
      </Field>

      <Field label="Notes" name="notes" error={e.notes} hint="Anything that matters when dressing it: a button-down collar, a cropped length.">
        <TextArea name="notes" defaultValue={v.notes} error={e.notes} rows={2} />
      </Field>

      <div className="space-y-4 pt-2">
        <FormMessage message={state?.message ?? (Object.keys(e).length ? 'Check the fields marked above.' : undefined)} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pending="Saving">{submitLabel}</SubmitButton>
          {another ? <AnotherButton /> : null}
        </div>
      </div>
    </form>
  )
}

function SwatchRadios({ title, swatches, chosen }: { title: string; swatches: Swatch[]; chosen: string }) {
  if (swatches.length === 0) return null
  return (
    <div className="mb-4">
      <p className="mb-2 text-sm text-ink-3">{title}</p>
      <div className="grid grid-cols-6 gap-x-3 gap-y-4 sm:grid-cols-8">
        {swatches.map((swatch) => (
          <label key={swatch.hex} className="swatch-toggle cursor-pointer">
            <input type="radio" name="colour_hex" value={swatch.hex} defaultChecked={chosen === swatch.hex} className="sr-only" />
            <span className="sr-only">{swatch.name}</span>
            <ColourSwatch colour={swatch.hex} name={swatch.name} className="aspect-[3/4] w-full" />
          </label>
        ))}
      </div>
    </div>
  )
}

/** Saves like the main button, then opens a fresh add form instead of the list. */
function AnotherButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name="then"
      value="another"
      disabled={pending}
      className="btn btn-quiet disabled:cursor-progress"
    >
      Save and add another
    </button>
  )
}
