'use client'

import { useActionState } from 'react'

import { Field, FormMessage, SubmitButton, TextArea, withEcho } from '@/components/form'
import type { RuleSectionName, Section } from '@/lib/style-guide'

import { submitSection } from '../../actions'
import { AddRow, MiniField, RemoveRow, fromEcho, keyed, rowInput, useRows, type Keyed } from '../rows'

type RuleRow = { topic: string; rule: string }

export function SectionForm({ name, section }: { name: RuleSectionName; section: Section }) {
  const [state, action] = useActionState(submitSection, null)
  const errors = state?.errors ?? {}
  const v = withEcho({ summary: section.summary }, state?.values)
  const initial: Keyed<RuleRow>[] = state?.values
    ? fromEcho(state.values, 'rules', ['topic', 'rule'] as const)
    : keyed(section.rules)

  return (
    <form action={action} className="mt-8 max-w-2xl space-y-10" key={state?.values ? JSON.stringify(state.values) : 'saved'}>
      <input type="hidden" name="section" value={name} />
      <Field label="The idea behind the rules" name="summary" error={errors.summary}>
        <TextArea name="summary" defaultValue={v.summary} rows={3} error={errors.summary} />
      </Field>
      <Rules initial={initial} errors={errors} />
      <div className="space-y-4">
        <FormMessage message={state?.message ?? (Object.keys(errors).length ? 'Check the rows marked above.' : undefined)} />
        <SubmitButton pending="Saving">Save</SubmitButton>
      </div>
    </form>
  )
}

function Rules({ initial, errors }: { initial: Keyed<RuleRow>[]; errors: Record<string, string> }) {
  const { rows, add, remove } = useRows(initial, () => ({ topic: '', rule: '' }))
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-2">Rules</legend>
      <ul className="mt-1 divide-y divide-line">
        {rows.map((row, index) => {
          const topic = rowInput('rules', row.key, 'topic', errors)
          const rule = rowInput('rules', row.key, 'rule', errors)
          return (
            <li key={row.key} className="flex gap-3 py-4">
              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <MiniField label="Topic" htmlFor={topic.props.id} error={topic.error}>
                  <input {...topic.props} type="text" defaultValue={row.value.topic} className="field" />
                </MiniField>
                <MiniField label="Rule" htmlFor={rule.props.id} error={rule.error}>
                  <textarea {...rule.props} defaultValue={row.value.rule} rows={4} className="field" />
                </MiniField>
              </div>
              <RemoveRow label={`Remove rule ${index + 1}`} onClick={() => remove(row.key)} />
            </li>
          )
        })}
      </ul>
      <AddRow onClick={add}>Add a rule</AddRow>
    </fieldset>
  )
}
