'use client'

import { useActionState } from 'react'

import { Field, FormMessage, SubmitButton, TextArea, withEcho } from '@/components/form'
import type { Taste } from '@/lib/profile'

import { submitTaste } from '../actions'

export function TasteForm({ taste }: { taste: Partial<Taste> }) {
  const [state, action] = useActionState(submitTaste, null)
  const e = state?.errors ?? {}
  const v = withEcho({ references: taste.references, no_gos: taste.no_gos, owned: taste.owned }, state?.values)

  return (
    <form action={action} className="mt-8 max-w-2xl space-y-6">
      <Field
        label="What you keep coming back to"
        name="references"
        error={e.references}
        hint="Brands, people, films, a shop you like walking into."
      >
        <TextArea name="references" defaultValue={v.references} error={e.references} rows={5} />
      </Field>
      <Field label="What you will not wear" name="no_gos" error={e.no_gos} hint="Logos, skinny fits, certain colours, whatever it is.">
        <TextArea name="no_gos" defaultValue={v.no_gos} error={e.no_gos} />
      </Field>
      <Field label="Things you own and like" name="owned" error={e.owned} hint="So the blueprint builds around them rather than replacing them.">
        <TextArea name="owned" defaultValue={v.owned} error={e.owned} rows={5} />
      </Field>
      <div className="space-y-4 pt-2">
        <FormMessage message={state?.message} />
        <SubmitButton pending="Saving">Save taste</SubmitButton>
      </div>
    </form>
  )
}
