'use client'

import { useActionState, useState } from 'react'

import { Field, FormMessage, NumberInput, SubmitButton, withEcho } from '@/components/form'
import type { FinderSettings, StoreCount } from '@/lib/finder/settings'

import { submitFinderSettings } from '../actions'

export function FinderForm({
  settings,
  stores,
  perScore,
}: {
  settings: FinderSettings
  stores: StoreCount[]
  perScore: number | null
}) {
  const [state, action] = useActionState(submitFinderSettings, null)
  const e = state?.errors ?? {}
  const v = withEcho(
    {
      max_usd_per_run: settings.max_usd_per_run,
      max_usd_per_month: settings.max_usd_per_month,
      max_usd_per_search: settings.max_usd_per_search,
      max_usd_statements: settings.max_usd_statements,
    },
    state?.values,
  )
  const nightly = perScore && perScore > 0 ? Math.floor(settings.max_usd_per_run / perScore) : null
  const initiallyOn = state?.values
    ? (state.values.stores ?? '').split(',').filter(Boolean)
    : stores.filter((store) => store.enabled).map((store) => store.slug)

  return (
    <form action={action} className="mt-12 max-w-2xl">
      <h2 className="caption text-ink-2">Limits</h2>
      <div className="mt-3 grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <Field
          label="Finds in one night"
          name="max_usd_per_run"
          error={e.max_usd_per_run}
          hint={nightly !== null ? `About ${nightly.toLocaleString('en-NZ')} pieces judged. 0 turns judging off.` : '0 turns judging off.'}
        >
          <NumberInput name="max_usd_per_run" defaultValue={v.max_usd_per_run} unit="US$" error={e.max_usd_per_run} />
        </Field>
        <Field
          label="Statement pieces in one night"
          name="max_usd_statements"
          error={e.max_usd_statements}
          hint={limitHint(settings.max_usd_statements, perScore, 'them')}
        >
          <NumberInput name="max_usd_statements" defaultValue={v.max_usd_statements} unit="US$" error={e.max_usd_statements} />
        </Field>
        <Field
          label="Most in one search"
          name="max_usd_per_search"
          error={e.max_usd_per_search}
          hint={limitHint(settings.max_usd_per_search, perScore, 'search')}
        >
          <NumberInput name="max_usd_per_search" defaultValue={v.max_usd_per_search} unit="US$" error={e.max_usd_per_search} />
        </Field>
        <Field label="Most in a month" name="max_usd_per_month" error={e.max_usd_per_month} hint="Nights and searches together. Empty for no limit.">
          <NumberInput name="max_usd_per_month" defaultValue={v.max_usd_per_month} unit="US$" error={e.max_usd_per_month} />
        </Field>
      </div>
      {perScore ? (
        <p className="mt-4 text-sm text-ink-3">
          Judging costs about US${perScore.toFixed(4)} a piece, measured over the last 30 days.
        </p>
      ) : null}

      <StoreSwitches stores={stores} initiallyOn={initiallyOn} error={e.stores} />

      <div className="mt-10 space-y-4">
        <FormMessage message={state?.message} />
        <SubmitButton pending="Saving">Save finder settings</SubmitButton>
      </div>
    </form>
  )
}

function limitHint(limit: number, perScore: number | null, what: string): string {
  if (!perScore || perScore <= 0) return `0 turns ${what} off.`
  const pieces = Math.floor(limit / perScore)
  return `About ${pieces.toLocaleString('en-NZ')} pieces judged. 0 turns ${what} off.`
}

/**
 * One switch per store, with what it brought and cost in the latest run, the
 * costliest first. A switch is a plain checkbox in a segment, so it posts with
 * the form and works before the page has hydrated; the label follows its state.
 */
function StoreSwitches({ stores, initiallyOn, error }: { stores: StoreCount[]; initiallyOn: string[]; error?: string }) {
  const [on, setOn] = useState(() => new Set(initiallyOn))

  return (
    <fieldset className="mt-12" aria-describedby={error ? 'stores-error' : undefined}>
      <legend className="caption text-ink-2">Shops</legend>
      <p className="mt-1 max-w-[44ch] text-sm text-ink-3">
        A shop switched off is not read, judged or shown. The numbers are from the last run: shortlisted, good enough
        to show, and what judging cost.
      </p>
      {error ? (
        <p id="stores-error" role="alert" className="mt-3 text-sm text-alert">
          {error}
        </p>
      ) : null}

      {stores.length === 0 ? (
        <p className="mt-4 text-[0.9375rem] text-ink-3">No shops yet. They are added when the app starts and on every run.</p>
      ) : null}
      <ul className="mt-3 divide-y divide-line empty:hidden">
        {stores.map((store) => {
          const checked = on.has(store.slug)
          return (
            <li key={store.slug} className="flex min-h-18 items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{store.name}</p>
                <p className="text-sm text-ink-2 tabular-nums">
                  {store.shortlisted.toLocaleString('en-NZ')} shortlisted, {store.finds.toLocaleString('en-NZ')}{' '}
                  {store.finds === 1 ? 'find' : 'finds'}
                  {store.usd > 0 ? `, US$${store.usd.toFixed(2)}` : ''}
                </p>
                <p className="text-sm text-ink-3 tabular-nums">{store.products.toLocaleString('en-NZ')} pieces in stock</p>
              </div>
              <label className="segment pressable shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  name="stores"
                  value={store.slug}
                  checked={checked}
                  onChange={(event) => {
                    const next = new Set(on)
                    if (event.target.checked) next.add(store.slug)
                    else next.delete(store.slug)
                    setOn(next)
                  }}
                  className="sr-only"
                />
                <span aria-hidden>{checked ? 'On' : 'Off'}</span>
                <span className="sr-only">Read {store.name}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
