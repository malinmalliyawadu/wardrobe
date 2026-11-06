'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { Swatch } from '@/components/cloth'
import { Field, FormMessage, NumberInput, Select, SubmitButton, TextArea, TextInput, withEcho } from '@/components/form'
import { FITS, label } from '@/lib/profile-values'
import {
  BUDGET_CATEGORY,
  GARMENT_LABELS,
  GARMENT_TYPES,
  PRIORITIES,
  PRIORITY_LABELS,
  type GarmentType,
} from '@/lib/wardrobe-values'

import { submitSlot } from './actions'

export type SlotFormValues = {
  name: string
  why: string
  priority: number
  garment_type: string
  colour_family: string
  colours: string[]
  fabrics: string
  fit: string
  size_labels: string
  size_note: string
  budget_min: number | null
  budget_max: number | null
}

type PaletteSwatch = { hex: string; name: string }

/**
 * Every field of a slot. Colours are picked from the guide's palette rather
 * than typed, so a slot always speaks the palette the finder checks against;
 * a colour already on the slot that the palette no longer has stays available.
 */
export function SlotForm({
  id,
  initial,
  best,
  neutrals,
  ceilings,
}: {
  id?: number
  initial: SlotFormValues
  best: PaletteSwatch[]
  neutrals: PaletteSwatch[]
  ceilings: Record<string, number | null | undefined>
}) {
  const [state, action] = useActionState(submitSlot, null)
  const e = state?.errors ?? {}
  const echoed = state?.values
  const v = withEcho(
    {
      name: initial.name,
      why: initial.why,
      priority: String(initial.priority),
      garment_type: initial.garment_type,
      colour_family: initial.colour_family,
      fabrics: initial.fabrics,
      fit: initial.fit,
      size_labels: initial.size_labels,
      size_note: initial.size_note,
      budget_min: initial.budget_min,
      budget_max: initial.budget_max,
    },
    echoed,
  )
  const chosen = new Set(echoed ? (echoed.colours ?? '').split(',').filter(Boolean) : initial.colours)
  const known = new Set([...best, ...neutrals].map((swatch) => swatch.hex))
  const others = [...chosen].filter((hex) => !known.has(hex)).map((hex) => ({ hex, name: hex }))
  const [garment, setGarment] = useState(v.garment_type)
  const category = garment && garment in BUDGET_CATEGORY ? BUDGET_CATEGORY[garment as GarmentType] : null
  const ceiling = category ? ceilings[category] : null

  return (
    <form action={action} className="mt-8 max-w-2xl space-y-7" key={echoed ? JSON.stringify(echoed) : 'saved'}>
      {id ? <input type="hidden" name="id" value={id} /> : null}

      <Field label="Name" name="name" error={e.name} hint="As you would ask for it in a shop.">
        <TextInput name="name" defaultValue={v.name} error={e.name} placeholder="Navy unstructured wool overshirt" />
      </Field>

      <Field label="Why" name="why" error={e.why} hint="One sentence. The finder reads this too.">
        <TextArea name="why" defaultValue={v.why} error={e.why} rows={3} />
      </Field>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">Priority</legend>
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((priority) => (
            <label key={priority} className="segment pressable">
              <input
                type="radio"
                name="priority"
                value={priority}
                defaultChecked={String(v.priority) === String(priority)}
                className="sr-only"
              />
              {PRIORITY_LABELS[priority].title}
            </label>
          ))}
        </div>
        {e.priority ? (
          <p role="alert" className="mt-1.5 text-sm text-alert">
            Pick a priority
          </p>
        ) : null}
      </fieldset>

      <Field label="Garment" name="garment_type" error={e.garment_type}>
        <Select
          name="garment_type"
          defaultValue={v.garment_type}
          options={GARMENT_TYPES.map((type) => ({ value: type, label: GARMENT_LABELS[type] }))}
          placeholder="Choose one"
          error={e.garment_type}
          onChange={setGarment}
        />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-ink-2">Colours</legend>
        <p className="mt-1 mb-4 text-sm text-ink-3">From your palette. One to three.</p>
        <SwatchPicker title="Best" swatches={best} chosen={chosen} />
        <SwatchPicker title="Neutrals" swatches={neutrals} chosen={chosen} />
        {others.length ? <SwatchPicker title="Not in your palette" swatches={others} chosen={chosen} /> : null}
        {e.colours ? (
          <p role="alert" className="mt-1.5 text-sm text-alert">
            {e.colours}
          </p>
        ) : null}
      </fieldset>

      <Field label="Colour in words" name="colour_family" error={e.colour_family} hint="What the finder looks for in a product title.">
        <TextInput name="colour_family" defaultValue={v.colour_family} error={e.colour_family} placeholder="Navy" />
      </Field>

      <div className="grid gap-7 sm:grid-cols-2 sm:gap-x-4">
        <Field label="Fabrics" name="fabrics" error={e.fabrics} hint="In order of preference, separated by commas.">
          <TextInput name="fabrics" defaultValue={v.fabrics} error={e.fabrics} placeholder="Wool, brushed cotton" />
        </Field>
        <Field label="Fit" name="fit" error={e.fit}>
          <Select
            name="fit"
            defaultValue={v.fit}
            options={FITS.map((fit) => ({ value: fit, label: label(fit) }))}
            placeholder="Any, or not a fit garment"
            error={e.fit}
          />
        </Field>
      </div>

      <div className="grid gap-7 sm:grid-cols-2 sm:gap-x-4">
        <Field label="Sizes to look for" name="size_labels" error={e.size_labels} hint="Labels as shops print them, separated by commas.">
          <TextInput name="size_labels" defaultValue={v.size_labels} error={e.size_labels} placeholder="S, EU 42" />
        </Field>
        <Field label="Sizing note" name="size_note" error={e.size_note}>
          <TextArea name="size_note" defaultValue={v.size_note} error={e.size_note} rows={2} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">Budget</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From" name="budget_min" error={e.budget_min}>
            <NumberInput name="budget_min" defaultValue={v.budget_min} unit="NZD" integer error={e.budget_min} />
          </Field>
          <Field label="To" name="budget_max" error={e.budget_max}>
            <NumberInput name="budget_max" defaultValue={v.budget_max} unit="NZD" integer error={e.budget_max} />
          </Field>
        </div>
        <p className="mt-1.5 text-sm text-ink-3">
          {category ? (
            ceiling ? (
              `Your ceiling for ${category} is $${ceiling}.`
            ) : (
              <>
                No ceiling set for {category}.{' '}
                <Link href="/you/budget" className="text-accent underline decoration-accent/40 underline-offset-4">
                  Set one
                </Link>
              </>
            )
          ) : (
            'Whole New Zealand dollars.'
          )}
        </p>
      </fieldset>

      {id ? null : (
        <label className="flex min-h-11 items-center gap-3 text-[0.9375rem]">
          <input type="checkbox" name="status" value="owned" className="size-5 accent-[var(--accent)]" />
          I already own this
        </label>
      )}

      <div className="space-y-4 pt-2">
        <FormMessage message={state?.message ?? (Object.keys(e).length ? 'Check the fields marked above.' : undefined)} />
        <SubmitButton pending="Saving">{id ? 'Save slot' : 'Add slot'}</SubmitButton>
      </div>
    </form>
  )
}

/** A run of palette colours as toggles; the chosen ones wear an ink ring. */
function SwatchPicker({ title, swatches, chosen }: { title: string; swatches: PaletteSwatch[]; chosen: Set<string> }) {
  if (swatches.length === 0) return null
  return (
    <div className="mb-5">
      <p className="caption mb-2">{title}</p>
      <div className="grid grid-cols-6 gap-3 sm:grid-cols-8">
        {swatches.map((swatch) => (
          <label key={swatch.hex} className="swatch-toggle cursor-pointer">
            <input type="checkbox" name="colours" value={swatch.hex} defaultChecked={chosen.has(swatch.hex)} className="sr-only" />
            <span className="sr-only">{swatch.name}</span>
            <Swatch colour={swatch.hex} name={swatch.name} className="aspect-[3/4] w-full" />
          </label>
        ))}
      </div>
    </div>
  )
}
