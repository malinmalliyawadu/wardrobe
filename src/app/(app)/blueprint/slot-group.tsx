'use client'

import Link from 'next/link'
import { useOptimistic, useState, useTransition } from 'react'

import { SlotSwatches } from '@/components/cloth'
import { ChevronIcon, TickIcon } from '@/components/icons'
import { SectionHead } from '@/components/section'

import { reorderSlot } from './actions'

/** What a row needs, already formatted on the server. */
export type SlotRow = {
  id: number
  name: string
  why: string
  colours: string[]
  colourNames: (string | null)[]
  band: string | null
  status: string
  owned: boolean
}

type Move = { id: number; direction: 'up' | 'down' }

function applyMove(rows: SlotRow[], { id, direction }: Move): SlotRow[] {
  const index = rows.findIndex((row) => row.id === id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= rows.length) return rows
  const next = [...rows]
  ;[next[index], next[target]] = [next[target] as SlotRow, next[index] as SlotRow]
  return next
}

/**
 * One priority. Rows link to the slot. "Reorder" swaps the chevrons for
 * up and down buttons; a move shows at once and is saved behind it. Nothing
 * animates: reordering is a run of quick taps, and motion would only lag them.
 */
export function SlotGroup({
  title,
  hint,
  summary,
  rows,
  first = false,
}: {
  title: string
  hint: string
  summary: string
  rows: SlotRow[]
  /** The first group sits level with the left column on the laptop. */
  first?: boolean
}) {
  const [reordering, setReordering] = useState(false)
  const [optimistic, move] = useOptimistic(rows, applyMove)
  const [, startTransition] = useTransition()
  const headingId = `group-${title.toLowerCase().replace(/\s+/g, '-')}`

  function send(id: number, direction: 'up' | 'down') {
    startTransition(async () => {
      move({ id, direction })
      const form = new FormData()
      form.set('id', String(id))
      form.set('direction', direction)
      await reorderSlot(form)
    })
  }

  return (
    <section aria-labelledby={headingId} className={first ? 'mt-14 lg:mt-0' : 'mt-14'}>
      <SectionHead id={headingId} title={title} aside={summary} />
      <div className="flex items-center justify-between gap-4">
        <p className="caption">{hint}</p>
        {rows.length > 1 ? (
          <button
            type="button"
            className="text-button -mr-2 shrink-0"
            aria-pressed={reordering}
            onClick={() => setReordering((value) => !value)}
          >
            {reordering ? 'Done' : 'Reorder'}
          </button>
        ) : null}
      </div>

      <ol className="mt-2 divide-y divide-line">
        {optimistic.map((row, index) => (
          <li key={row.id}>
            {reordering ? (
              <div className="flex min-h-18 items-center gap-3 py-3">
                <SlotSwatches colours={row.colours} names={row.colourNames} />
                <p className="title min-w-0 flex-1 text-[1.125rem]">{row.name}</p>
                <div className="flex shrink-0 gap-1.5">
                  <MoveButton label={`Move ${row.name} up`} disabled={index === 0} onClick={() => send(row.id, 'up')} up />
                  <MoveButton
                    label={`Move ${row.name} down`}
                    disabled={index === optimistic.length - 1}
                    onClick={() => send(row.id, 'down')}
                  />
                </div>
              </div>
            ) : (
              <SlotLink row={row} />
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function SlotLink({ row, muted = false }: { row: SlotRow; muted?: boolean }) {
  return (
    <Link href={`/blueprint/${row.id}`} className="pressable -mx-2 flex gap-3 rounded-[var(--radius-control)] px-2 py-4">
      <SlotSwatches colours={row.colours} names={row.colourNames} />
      <div className="min-w-0 flex-1">
        <p className={`title text-[1.125rem] ${muted ? 'text-ink-2' : ''}`}>{row.name}</p>
        <p className="prose mt-1 text-[0.9375rem] text-ink-2">{row.why}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-3 tabular-nums">
          {row.owned ? <TickIcon className="shrink-0" /> : null}
          <span>
            {row.status}
            {row.band ? `, ${row.band}` : ''}
          </span>
        </p>
      </div>
      <ChevronIcon className="mt-1 shrink-0 text-ink-3" />
    </Link>
  )
}

function MoveButton({
  label,
  disabled,
  onClick,
  up = false,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  up?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="btn btn-quiet btn-small size-11 rounded-[var(--radius-control)] p-0"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
      </svg>
    </button>
  )
}
