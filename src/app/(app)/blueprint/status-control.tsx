'use client'

import { useOptimistic, useTransition } from 'react'

import { SLOT_STATUSES, STATUS_LABELS, type SlotStatus } from '@/lib/wardrobe-values'

import { changeStatus } from './actions'

const HINTS: Record<SlotStatus, string> = {
  wanted: 'The finder looks for this every night.',
  candidate: 'You have a product in mind. The finder keeps looking until you buy.',
  owned: 'In your wardrobe. The finder stops looking.',
  retired: 'Out of the blueprint. Refill it and Claude proposes a replacement.',
}

/**
 * Status saves on tap, without the rest of the form: it is the thing changed
 * most often on this page. The choice shows at once and is saved behind it.
 */
export function StatusControl({ id, status }: { id: number; status: SlotStatus }) {
  const [shown, setShown] = useOptimistic(status)
  const [, startTransition] = useTransition()

  function choose(next: SlotStatus) {
    if (next === shown) return
    startTransition(async () => {
      setShown(next)
      const form = new FormData()
      form.set('id', String(id))
      form.set('status', next)
      await changeStatus(form)
    })
  }

  return (
    <div role="group" aria-labelledby="status-label">
      <p id="status-label" className="mb-2 text-sm font-medium text-ink-2">
        Status
      </p>
      <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
        {SLOT_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={shown === value}
            onClick={() => choose(value)}
            className="segment pressable px-1 text-[0.875rem] sm:px-4 sm:text-[0.9375rem]"
          >
            {STATUS_LABELS[value]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-3" aria-live="polite">
        {HINTS[shown]}
      </p>
    </div>
  )
}
