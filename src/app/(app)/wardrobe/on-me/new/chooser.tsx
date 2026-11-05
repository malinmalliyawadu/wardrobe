'use client'

import { useActionState, useState } from 'react'

import { tryChosenOn } from '@/app/try-on-actions'
import { ButtonLink } from '@/components/button-link'
import { FormMessage, SubmitButton } from '@/components/form'
import { TickIcon } from '@/components/icons'
import { PieceImage } from '@/components/piece-image'
import type { Choice } from '@/lib/on-me'
import { choiceKey } from '@/lib/outfit-key'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

/*
 * His saved finds and his pieces as tiles to tick, with the count and the
 * button held above the tab bar so he never scrolls back for it. Each tile is
 * a real checkbox, so the form posts what is ticked and a screen reader reads
 * it as one. The ticks are held in state, so a refusal from the server keeps
 * them. When what is ticked was already put on him (`kept`, by outfitKey),
 * the button opens that picture instead of making another.
 */

export function Chooser({
  groups,
  max,
  kept,
}: {
  groups: { title: string; choices: Choice[] }[]
  max: number
  kept: Record<string, number>
}) {
  const [state, action] = useActionState(tryChosenOn, null)
  const [chosen, setChosen] = useState<string[]>([])
  const full = chosen.length >= max
  const made = chosen.length > 0 ? kept[choiceKey(chosen)] : undefined

  function toggle(key: string) {
    setChosen((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
  }

  return (
    <form action={action}>
      {groups.map((group) => (
        <fieldset key={group.title} className="mt-12">
          <legend className="w-full">
            <span className="caption flex items-baseline justify-between gap-4 text-ink-2">
              <span>{group.title}</span>
              <span className="tabular-nums">{group.choices.length}</span>
            </span>
          </legend>
          <ul className="mt-4 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 lg:grid-cols-5">
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

      <div className="tabbar bleed lg:mx-0 sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 mt-10 border-t border-line px-[var(--gutter)] pt-3 pb-4 lg:bottom-0">
        {state?.message ? (
          <div className="mb-3 max-w-2xl">
            <FormMessage message={state.message} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <p aria-live="polite" className="text-[0.9375rem] text-ink-2 tabular-nums">
            {chosen.length === 0 ? 'Nothing chosen' : `${chosen.length} of ${max} chosen`}
            {made !== undefined ? <span className="block text-[0.8125rem] text-ink-3">Already on you</span> : null}
          </p>
          {made !== undefined ? (
            <ButtonLink href={`/wardrobe/on-me/${made}`}>See the picture</ButtonLink>
          ) : chosen.length > 0 ? (
            <SubmitButton pending="Asking">See them on me</SubmitButton>
          ) : (
            <button type="button" disabled className="btn btn-primary">
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
      className={`pressable block cursor-pointer rounded-[var(--radius-tile)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
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
      <span className={`relative block rounded-[var(--radius-tile)] ring-offset-2 ring-offset-ground ${on ? 'ring-2 ring-ink' : ''}`}>
        <PieceImage
          piece={choice}
          label={choice.garment_type ? GARMENT_LABELS[choice.garment_type] : undefined}
          sizes="(min-width: 1024px) 12rem, (min-width: 640px) 9rem, 30vw"
          className="aspect-[3/4] rounded-[var(--radius-tile)]"
        />
        {on ? (
          <span aria-hidden className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-accent text-on-accent">
            <TickIcon width={14} height={14} strokeWidth={2.75} />
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
