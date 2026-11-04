'use client'

import Link from 'next/link'
import { useOptimistic, useState, useTransition } from 'react'

import { SlotSwatches } from '@/components/cloth'

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
}: {
  title: string
  hint: string
  summary: string
  rows: SlotRow[]
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
    <section aria-labelledby={headingId} className="mt-14">
      <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-[1.625rem] leading-tight tracking-[-0.005em]">
            {title}
          </h2>
          <p className="mt-1 text-sm text-ink-3">{hint}</p>
          <p className="mt-0.5 text-sm text-ink-2 tabular-nums">{summary}</p>
        </div>
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

      <ol className="divide-y divide-line">
        {optimistic.map((row, index) => (
          <li key={row.id}>
            {reordering ? (
              <div className="flex min-h-18 items-center gap-3 py-3">
                <SlotSwatches colours={row.colours} names={row.colourNames} />
                <p className="min-w-0 flex-1 font-display text-[1.125rem] leading-snug">{row.name}</p>
                <div className="flex shrink-0 gap-1">
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
    <Link href={`/blueprint/${row.id}`} className="pressable -mx-2 flex gap-3 rounded-xl px-2 py-4">
      <SlotSwatches colours={row.colours} names={row.colourNames} />
      <div className="min-w-0 flex-1">
        <p className={`font-display text-[1.1875rem] leading-snug tracking-[-0.003em] ${muted ? 'text-ink-2' : ''}`}>
          {row.name}
        </p>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-2">{row.why}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-3 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            {row.owned ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            ) : null}
            {row.status}
          </span>
          {row.band ? <span>{row.band}</span> : null}
        </p>
      </div>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="mt-1.5 shrink-0 text-ink-3"
      >
        <path d="m9 5 7 7-7 7" />
      </svg>
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
      className="pressable flex size-11 items-center justify-center rounded-full border border-line text-ink disabled:opacity-35 disabled:active:transform-none"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
      </svg>
    </button>
  )
}
