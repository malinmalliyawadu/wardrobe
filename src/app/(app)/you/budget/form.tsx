'use client'

import { useActionState } from 'react'

import { Field, FormMessage, NumberInput, SubmitButton, withEcho } from '@/components/form'
import type { Budget } from '@/lib/profile'

import { submitBudget } from '../actions'

const categories: { name: keyof Omit<Budget, 'monthly'>; label: string }[] = [
  { name: 'tees', label: 'Tees' },
  { name: 'shirts', label: 'Shirts' },
  { name: 'knits', label: 'Knits' },
  { name: 'trousers', label: 'Trousers' },
  { name: 'outerwear', label: 'Outerwear' },
  { name: 'shoes', label: 'Shoes' },
  { name: 'accessories', label: 'Accessories' },
]

export function BudgetForm({ budget }: { budget: Partial<Budget> }) {
  const [state, action] = useActionState(submitBudget, null)
  const e = state?.errors ?? {}
  const v = withEcho(
    {
      monthly: budget.monthly,
      tees: budget.tees,
      shirts: budget.shirts,
      knits: budget.knits,
      trousers: budget.trousers,
      outerwear: budget.outerwear,
      shoes: budget.shoes,
      accessories: budget.accessories,
    },
    state?.values,
  )

  return (
    <form action={action} className="mt-8 max-w-2xl">
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <Field label="A month, all in" name="monthly" error={e.monthly}>
          <NumberInput name="monthly" defaultValue={v.monthly} unit="NZD" integer error={e.monthly} />
        </Field>
      </div>

      <h2 className="caption mt-10 text-ink-2">Most you would pay for one</h2>
      <div className="mt-3 grid gap-x-4 gap-y-5 sm:grid-cols-2">
        {categories.map((category) => (
          <Field key={category.name} label={category.label} name={category.name} error={e[category.name]}>
            <NumberInput name={category.name} defaultValue={v[category.name]} unit="NZD" integer error={e[category.name]} />
          </Field>
        ))}
      </div>

      <div className="mt-10 space-y-4">
        <FormMessage message={state?.message} />
        <SubmitButton pending="Saving">Save budget</SubmitButton>
      </div>
    </form>
  )
}
