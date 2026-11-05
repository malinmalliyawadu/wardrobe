'use client'

import { useActionState } from 'react'

import { Field, FormMessage, PendingNote, SubmitButton, TextArea } from '@/components/form'

import { draftBlueprint, generateGuide, refillSlot } from './actions'

/** Step one: the style guide, drafted from the confirmed profile. */
export function GuideStep({ again = false }: { again?: boolean }) {
  const [state, action] = useActionState(generateGuide, null)
  return (
    <form action={action} className="space-y-3">
      <SubmitButton pending="Drafting your guide" variant={again ? 'quiet' : 'primary'}>
        {again ? 'Redraft the guide' : 'Draft my style guide'}
      </SubmitButton>
      <PendingNote>Opus is reading your profile. This takes a minute or two; keep the page open.</PendingNote>
      <FormMessage message={state?.message} />
    </form>
  )
}

/**
 * Step two, and the redraft. The first draft is the screen's one action, so
 * it is primary; a redraft sits under the slots and is quiet, with a note.
 */
export function DraftForm({ replaces, first }: { replaces: number; first: boolean }) {
  const [state, action] = useActionState(draftBlueprint, null)
  return (
    <form action={action} className="max-w-2xl space-y-4">
      {first ? null : (
        <Field
          label="What should change"
          name="note"
          hint={`Optional. Slots you wrote, edited, own or have a candidate for stay; the other ${replaces} are replaced.`}
        >
          <TextArea name="note" defaultValue={state?.values?.note} rows={3} placeholder="Fewer knits, more for the office" />
        </Field>
      )}
      <SubmitButton pending="Drafting the blueprint" variant={first ? 'primary' : 'quiet'}>
        {first ? 'Draft the blueprint' : 'Redraft the blueprint'}
      </SubmitButton>
      <PendingNote>Opus is working through your profile and guide. Allow two or three minutes.</PendingNote>
      <FormMessage message={state?.message} />
    </form>
  )
}

/** Ask Claude for the slot that takes a retired one's place. */
export function RefillForm({ id, compact = false }: { id: number; compact?: boolean }) {
  const [state, action] = useActionState(refillSlot, null)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {compact ? null : (
        <Field label="Anything it should know" name="note" hint="Optional. Why this one is retired, or what you want instead.">
          <TextArea name="note" defaultValue={state?.values?.note} rows={2} />
        </Field>
      )}
      <SubmitButton pending="Refilling" variant="quiet" size={compact ? 'small' : 'normal'}>
        Refill
      </SubmitButton>
      <PendingNote>About a minute.</PendingNote>
      <FormMessage message={state?.message} />
    </form>
  )
}
