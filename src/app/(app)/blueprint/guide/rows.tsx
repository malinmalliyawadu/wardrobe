'use client'

import { useState, type ReactNode } from 'react'

import { CrossIcon, PlusIcon } from '@/components/icons'

/*
 * Repeating rows for the guide editors. Each row's key doubles as the index in
 * its field names (best.3.hex), and keys only ever grow, so a removed row never
 * renumbers the others and a server error for best.3.hex still lands on the
 * row the user is looking at.
 */

export type Keyed<T> = { key: number; value: T }

export function keyed<T>(values: T[]): Keyed<T>[] {
  return values.map((value, key) => ({ key, value }))
}

/** Rebuild rows from the echoed form values after a failed save. */
export function fromEcho<F extends string>(
  echo: Record<string, string>,
  prefix: string,
  fields: readonly F[],
): Keyed<Record<F, string>>[] {
  const byKey = new Map<number, Record<F, string>>()
  for (const [name, value] of Object.entries(echo)) {
    const [head, index, field] = name.split('.')
    if (head !== prefix || !field || !(fields as readonly string[]).includes(field)) continue
    const key = Number(index)
    if (!Number.isInteger(key)) continue
    const row = byKey.get(key) ?? (Object.fromEntries(fields.map((f) => [f, ''])) as Record<F, string>)
    row[field as F] = value
    byKey.set(key, row)
  }
  return [...byKey.entries()].sort(([a], [b]) => a - b).map(([key, value]) => ({ key, value }))
}

export function useRows<T>(initial: Keyed<T>[], blank: () => T) {
  const [rows, setRows] = useState(initial)
  const [next, setNext] = useState(() => Math.max(-1, ...initial.map((row) => row.key)) + 1)
  return {
    rows,
    add() {
      setRows((current) => [...current, { key: next, value: blank() }])
      setNext((value) => value + 1)
    },
    remove(key: number) {
      setRows((current) => current.filter((row) => row.key !== key))
    },
  }
}

export function MiniField({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="caption mb-1 block">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-sm text-alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** The cross at a row's end: a circular icon button, the one place that shape belongs. */
export function RemoveRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="pressable flex size-11 shrink-0 items-center justify-center rounded-full text-ink-3"
    >
      <CrossIcon />
    </button>
  )
}

export function AddRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-button -ml-2 mt-2">
      <PlusIcon />
      {children}
    </button>
  )
}

/** Field props for one input in a row: id, name, and the error wiring. */
export function rowInput(prefix: string, key: number, field: string, errors: Record<string, string>) {
  const name = `${prefix}.${key}.${field}`
  const error = errors[name]
  return {
    error,
    props: {
      id: name,
      name,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${name}-error` : undefined,
    },
  } as const
}
