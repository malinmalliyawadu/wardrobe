'use client'

import { useActionState } from 'react'

import { Field, FormMessage, NumberInput, Select, SubmitButton, withEcho } from '@/components/form'
import { FITS, label, TEE_SIZES } from '@/lib/profile-values'
import type { Fits, Sizes } from '@/lib/profile'

import { submitSizes } from '../actions'

const fitOptions = FITS.map((value) => ({ value, label: label(value) }))

export function SizesForm({
  heightCm,
  sizes,
  fits,
}: {
  heightCm: number | null
  sizes: Partial<Sizes>
  fits: Partial<Fits>
}) {
  const [state, action] = useActionState(submitSizes, null)
  const e = state?.errors ?? {}
  const v = withEcho(
    {
      height_cm: heightCm,
      tee: sizes.tee,
      chest_cm: sizes.chest_cm,
      waist_cm: sizes.waist_cm,
      hips_cm: sizes.hips_cm,
      inseam_cm: sizes.inseam_cm,
      sleeve_cm: sizes.sleeve_cm,
      neck_cm: sizes.neck_cm,
      shoe_eu: sizes.shoe_eu,
      shoe_uk: sizes.shoe_uk,
      shoe_us: sizes.shoe_us,
      tops: fits.tops,
      knits: fits.knits,
      trousers: fits.trousers,
      outerwear: fits.outerwear,
    },
    state?.values,
  )

  return (
    <form action={action} className="mt-8 max-w-2xl">
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <Field label="Height" name="height_cm" error={e.height_cm}>
          <NumberInput name="height_cm" defaultValue={v.height_cm} unit="cm" error={e.height_cm} />
        </Field>
        <Field label="Tee size" name="tee" error={e.tee}>
          <Select name="tee" defaultValue={v.tee} options={TEE_SIZES.map((s) => ({ value: s, label: s }))} error={e.tee} />
        </Field>
      </div>

      <h2 className="caption mt-10 text-ink-2">Measurements</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
        <Field label="Chest" name="chest_cm" error={e.chest_cm}>
          <NumberInput name="chest_cm" defaultValue={v.chest_cm} unit="cm" error={e.chest_cm} />
        </Field>
        <Field label="Waist" name="waist_cm" error={e.waist_cm} hint="Where trousers sit">
          <NumberInput name="waist_cm" defaultValue={v.waist_cm} unit="cm" error={e.waist_cm} />
        </Field>
        <Field label="Hips" name="hips_cm" error={e.hips_cm}>
          <NumberInput name="hips_cm" defaultValue={v.hips_cm} unit="cm" error={e.hips_cm} />
        </Field>
        <Field label="Inseam" name="inseam_cm" error={e.inseam_cm}>
          <NumberInput name="inseam_cm" defaultValue={v.inseam_cm} unit="cm" error={e.inseam_cm} />
        </Field>
        <Field label="Sleeve" name="sleeve_cm" error={e.sleeve_cm} hint="Centre back to wrist">
          <NumberInput name="sleeve_cm" defaultValue={v.sleeve_cm} unit="cm" error={e.sleeve_cm} />
        </Field>
        <Field label="Neck" name="neck_cm" error={e.neck_cm}>
          <NumberInput name="neck_cm" defaultValue={v.neck_cm} unit="cm" error={e.neck_cm} />
        </Field>
      </div>

      <h2 className="caption mt-10 text-ink-2">Shoes</h2>
      <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-5">
        <Field label="EU" name="shoe_eu" error={e.shoe_eu}>
          <NumberInput name="shoe_eu" defaultValue={v.shoe_eu} error={e.shoe_eu} />
        </Field>
        <Field label="UK" name="shoe_uk" error={e.shoe_uk}>
          <NumberInput name="shoe_uk" defaultValue={v.shoe_uk} error={e.shoe_uk} />
        </Field>
        <Field label="US" name="shoe_us" error={e.shoe_us}>
          <NumberInput name="shoe_us" defaultValue={v.shoe_us} error={e.shoe_us} />
        </Field>
      </div>

      <h2 className="caption mt-10 text-ink-2">The fit you prefer</h2>
      <div className="mt-3 grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <Field label="Tops" name="tops" error={e.tops}>
          <Select name="tops" defaultValue={v.tops} options={fitOptions} error={e.tops} />
        </Field>
        <Field label="Knits" name="knits" error={e.knits}>
          <Select name="knits" defaultValue={v.knits} options={fitOptions} error={e.knits} />
        </Field>
        <Field label="Trousers" name="trousers" error={e.trousers}>
          <Select name="trousers" defaultValue={v.trousers} options={fitOptions} error={e.trousers} />
        </Field>
        <Field label="Outerwear" name="outerwear" error={e.outerwear}>
          <Select name="outerwear" defaultValue={v.outerwear} options={fitOptions} error={e.outerwear} />
        </Field>
      </div>

      <div className="mt-10 space-y-4">
        <FormMessage message={state?.message} />
        <SubmitButton pending="Saving">Save sizes</SubmitButton>
      </div>
    </form>
  )
}
