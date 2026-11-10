'use client'

import { useActionState, useState } from 'react'

import { Field, FormMessage, SubmitButton, TextInput, withEcho } from '@/components/form'
import { OUTFIT_SOURCES, SOURCE_LABELS, type OutfitSource } from '@/lib/outfit-values'

import { askOutfit } from '../actions'

const HINTS: Record<OutfitSource, string> = {
  wardrobe: 'Only what you own, as a look you can save and wear.',
  shops: 'Nothing you own: a whole outfit to buy, in your size.',
  both: 'What you own, and from the shops only what it lacks.',
  anywhere: 'Tied to no shop and nothing you own: the ideal pieces described, and a picture of you in them. Your full-length photo goes to OpenAI for it.',
}

/** Briefs to start from: a tap puts one in the field, to send as it is or to add to. */
const PROMPTS = [
  'A wedding on Saturday',
  'A first date, dinner and a drink',
  'Dinner with her parents',
  'A job interview',
  'Friday drinks after work',
  'A long weekend in Queenstown',
  'A wet, windy day in town',
  'Something bolder than I usually wear',
]

/**
 * The ask: what the outfit is for, in his words or from a prompt he taps,
 * and what it is made from. One outfit comes back. The page opens on it at
 * once and fills in while it is made.
 */
export function AskForm({ sources, initial }: { sources: OutfitSource[]; initial: OutfitSource }) {
  const [state, action] = useActionState(askOutfit, null)
  const v = withEcho({ brief: '', source: initial }, state?.values)
  // A tapped prompt replaces what the field holds; the count remounts it even when the same one is tapped twice.
  const [prompt, setPrompt] = useState({ text: v.brief ?? '', taps: 0 })
  const [source, setSource] = useState<OutfitSource>(sources.includes(v.source as OutfitSource) ? (v.source as OutfitSource) : initial)
  return (
    <form action={action} className="max-w-2xl space-y-5" key={state?.values ? JSON.stringify(state.values) : 'blank'}>
      <div>
        <Field label="What is it for?" name="brief" hint="Optional. Your own words, or start from one of these.">
          <TextInput key={prompt.taps} name="brief" defaultValue={prompt.text} />
        </Field>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Briefs to start from">
          {PROMPTS.map((text) => (
            <button key={text} type="button" className="chip pressable" onClick={() => setPrompt({ text, taps: prompt.taps + 1 })}>
              {text}
            </button>
          ))}
        </div>
      </div>
      <fieldset>
        <legend className="mb-3 text-sm font-medium text-ink-2">Made from</legend>
        <div className="flex flex-wrap gap-2">
          {OUTFIT_SOURCES.filter((option) => sources.includes(option)).map((option) => (
            <label key={option} className="segment pressable">
              <input
                type="radio"
                name="source"
                value={option}
                defaultChecked={source === option}
                onChange={() => setSource(option)}
                className="sr-only"
              />
              {SOURCE_LABELS[option]}
            </label>
          ))}
        </div>
        <p className="mt-2 max-w-[48ch] text-sm text-ink-3" aria-live="polite">
          {HINTS[source]}
        </p>
      </fieldset>
      <div className="space-y-3">
        <SubmitButton pending="Starting">Make an outfit</SubmitButton>
        <FormMessage message={state?.message} />
      </div>
    </form>
  )
}
