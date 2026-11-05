'use client'

import { useActionState, useState } from 'react'

import { Swatch } from '@/components/cloth'
import { Field, FormMessage, Select, SubmitButton, TextInput, withEcho } from '@/components/form'
import type { Analysis } from '@/lib/analysis'
import {
  BUILDS,
  CONTRAST_LEVELS,
  label,
  NECK_LENGTHS,
  SEASONS,
  SHOULDER_HIP,
  SKIN_DEPTHS,
  TORSO_LEG,
  UNDERTONES,
  type Season,
} from '@/lib/profile-values'
import { SEASON_INFO, seasonName } from '@/lib/seasons'

import { submitColouring } from '../actions'

type Read = { value: string; confidence: number; why: string }

function options(values: readonly string[]) {
  return values.map((value) => ({ value, label: label(value) }))
}

export function ColouringForm({ analysis }: { analysis: Analysis }) {
  const [state, action] = useActionState(submitColouring, null)
  const [season, setSeason] = useState<Season>(analysis.colouring.season.value)
  const c = analysis.colouring
  const p = analysis.proportions
  const errors = state?.errors ?? {}
  const v = withEcho(
    {
      season: c.season.value,
      undertone: c.undertone.value,
      skin_depth: c.skin_depth.value,
      contrast_level: c.contrast_level.value,
      hair_colour: c.hair_colour.value,
      hair_texture: c.hair_texture.value,
      eye_colour: c.eye_colour.value,
      build: p.build.value,
      shoulder_hip: p.shoulder_hip.value,
      torso_leg: p.torso_leg.value,
      neck_length: p.neck_length.value,
    },
    state?.values,
  )

  return (
    <form action={action} className="mt-10 max-w-2xl">
      <h2 className="caption text-ink-2">Colouring</h2>
      <div className="divide-y divide-line">
        <ReadRow name="season" title="Season" read={c.season} error={errors.season}>
          <Select name="season" defaultValue={v.season} options={SEASONS.map((s) => ({ value: s, label: seasonName(s) }))} onChange={(v) => { if (v) setSeason(v as Season) }} error={errors.season} />
          <SeasonStrip season={season} />
          {c.runner_up_season ? (
            <p className="mt-2 text-sm text-ink-3">Runner-up: {seasonName(c.runner_up_season)}.</p>
          ) : null}
        </ReadRow>
        <ReadRow name="undertone" title="Undertone" read={c.undertone} error={errors.undertone}>
          <Select name="undertone" defaultValue={v.undertone} options={options(UNDERTONES)} error={errors.undertone} />
        </ReadRow>
        <ReadRow name="skin_depth" title="Skin depth" read={c.skin_depth} error={errors.skin_depth}>
          <Select name="skin_depth" defaultValue={v.skin_depth} options={options(SKIN_DEPTHS)} error={errors.skin_depth} />
        </ReadRow>
        <ReadRow name="contrast_level" title="Contrast" read={c.contrast_level} error={errors.contrast_level}>
          <Select name="contrast_level" defaultValue={v.contrast_level} options={options(CONTRAST_LEVELS)} error={errors.contrast_level} />
        </ReadRow>
        <ReadRow name="hair_colour" title="Hair colour" read={c.hair_colour} error={errors.hair_colour}>
          <TextInput name="hair_colour" defaultValue={v.hair_colour} error={errors.hair_colour} />
        </ReadRow>
        <ReadRow name="hair_texture" title="Hair texture" read={c.hair_texture} error={errors.hair_texture}>
          <TextInput name="hair_texture" defaultValue={v.hair_texture} error={errors.hair_texture} />
        </ReadRow>
        <ReadRow name="eye_colour" title="Eye colour" read={c.eye_colour} error={errors.eye_colour}>
          <TextInput name="eye_colour" defaultValue={v.eye_colour} error={errors.eye_colour} />
        </ReadRow>
      </div>

      <h2 className="caption mt-10 text-ink-2">Proportions</h2>
      <div className="divide-y divide-line">
        <ReadRow name="build" title="Build" read={p.build} error={errors.build}>
          <Select name="build" defaultValue={v.build} options={options(BUILDS)} error={errors.build} />
        </ReadRow>
        <ReadRow name="shoulder_hip" title="Shoulders and hips" read={p.shoulder_hip} error={errors.shoulder_hip}>
          <Select name="shoulder_hip" defaultValue={v.shoulder_hip} options={options(SHOULDER_HIP)} error={errors.shoulder_hip} />
        </ReadRow>
        <ReadRow name="torso_leg" title="Torso and legs" read={p.torso_leg} error={errors.torso_leg}>
          <Select name="torso_leg" defaultValue={v.torso_leg} options={options(TORSO_LEG)} error={errors.torso_leg} />
        </ReadRow>
        <ReadRow name="neck_length" title="Neck" read={p.neck_length} error={errors.neck_length}>
          <Select name="neck_length" defaultValue={v.neck_length} options={options(NECK_LENGTHS)} error={errors.neck_length} />
        </ReadRow>
      </div>

      <div className="mt-10 space-y-4">
        <FormMessage message={state?.message} />
        <SubmitButton pending="Saving">Confirm profile</SubmitButton>
      </div>
    </form>
  )
}

/**
 * One attribute: the control on top, Claude's reasoning and confidence under
 * it. The reasoning is the point of the screen, so it is not hidden behind a
 * disclosure.
 */
function ReadRow({
  name,
  title,
  read,
  error,
  children,
}: {
  name: string
  title: string
  read: Read
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="py-5">
      <Field label={title} name={name} error={error}>
        {children}
      </Field>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        {read.why}{' '}
        <span className="whitespace-nowrap text-ink-3 tabular-nums">{read.confidence}% sure</span>
      </p>
    </div>
  )
}

/** The chosen season's six colours as flat chips, and its traits in a line. */
function SeasonStrip({ season }: { season: Season }) {
  const info = SEASON_INFO[season]
  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        {info.swatches.map((colour) => (
          <Swatch key={colour.hex} colour={colour.hex} label={colour.name} className="h-8 flex-1" />
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-2">
        {info.traits} {info.metal === 'mixed' ? 'Either metal works.' : `${label(info.metal)} hardware.`}
      </p>
    </div>
  )
}
