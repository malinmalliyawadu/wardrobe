'use client'

import { useActionState, useState } from 'react'

import { tryChosenOn } from '@/app/try-on-actions'
import { FormMessage, SubmitButton } from '@/components/form'
import { PieceImage } from '@/components/piece-image'
import type { Choice } from '@/lib/on-me'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

/*
 * His saved finds and his pieces as tiles to tick, with the count and the
 * button held above the tab bar so he never scrolls back for it. Each tile is
 * a real checkbox, so the form posts what is ticked and a screen reader reads
 * it as one. The ticks are held in state, so a refusal from the server keeps
 * them.
 */

export function Chooser({ groups, max }: { groups: { title: string; choices: Choice[] }[]; max: number }) {
  const [state, action] = useActionState(tryChosenOn, null)
  const [chosen, setChosen] = useState<string[]>([])
  const full = chosen.length >= max

  function toggle(key: string) {
    setChosen((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
  }

  return (
    <form action={action}>
      {groups.map((group) => (
        <fieldset key={group.title} className="mt-12">
          <legend className="w-full border-b border-line pb-3 font-display text-[1.625rem] leading-tight">{group.title}</legend>
          <ul className="mt-5 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4">
            {group.choices.map((choice) => {
              const on = chosen.includes(choice.key)
              return (
                <li key={choice.key}>
                  <Tile choice={choice} on={on} disabled={full && !on} onToggle={() => toggle(choice.key)} />
                </li>
              )
            })}
          </ul>
        </fieldset>
      ))}

      <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 -mx-5 mt-10 border-t border-line bg-ground/95 px-5 pt-3 pb-4 backdrop-blur-md lg:bottom-0 lg:-mx-12 lg:px-12">
        {state?.message ? (
          <div className="mb-3">
            <FormMessage message={state.message} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <p aria-live="polite" className="text-[0.9375rem] text-ink-2 tabular-nums">
            {chosen.length === 0 ? 'Nothing chosen' : `${chosen.length} of ${max} chosen`}
          </p>
          {chosen.length > 0 ? (
            <SubmitButton pending="Asking">See them on me</SubmitButton>
          ) : (
            <button type="button" disabled className="btn-primary inline-flex h-12 items-center rounded-full px-6 text-base font-medium opacity-40">
              See them on me
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

function Tile({ choice, on, disabled, onToggle }: { choice: Choice; on: boolean; disabled: boolean; onToggle: () => void }) {
  // Two colours of one product share a name, so each tile says its colour first.
  const sub = choice.colour_name
    ? titleCase(choice.colour_name)
    : (choice.retailer ?? (choice.garment_type ? GARMENT_LABELS[choice.garment_type] : null))
  return (
    <label
      className={`pressable block cursor-pointer rounded-xl has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brass ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <input
        type="checkbox"
        name="choice"
        value={choice.key}
        aria-label={sub ? `${choice.name}, ${sub}` : choice.name}
        checked={on}
        disabled={disabled}
        onChange={onToggle}
        className="sr-only"
      />
      <span className={`relative block rounded-xl ring-offset-2 ring-offset-ground ${on ? 'ring-2 ring-brass' : ''}`}>
        <PieceImage
          piece={choice}
          label={choice.garment_type ? GARMENT_LABELS[choice.garment_type] : undefined}
          sizes="(min-width: 640px) 9rem, 30vw"
          className="aspect-[3/4] rounded-xl"
        />
        {on ? (
          <span aria-hidden className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-brass text-on-brass">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
        ) : null}
      </span>
      <span className="mt-2 line-clamp-2 text-[0.875rem] leading-snug font-medium">{choice.name}</span>
      {sub ? <span className="mt-0.5 block truncate text-[0.75rem] text-ink-3">{sub}</span> : null}
    </label>
  )
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}
