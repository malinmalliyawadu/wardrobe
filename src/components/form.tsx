'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/*
 * Form primitives. Labels are always visible, errors sit under their field,
 * and inputs are 16px so iOS never zooms. Numbers are text inputs with a
 * decimal keyboard rather than type=number, which brings spinners and rejects
 * a stray comma.
 */

export function Field({
  label,
  name,
  hint,
  error,
  children,
}: {
  label: string
  name: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} role="alert" className="mt-1.5 text-sm text-alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}

export type DefaultValue = string | number | null | undefined

/**
 * Initial values for a form: the saved profile, overridden by whatever the
 * last failed submit echoed back, so a correction never costs the other fields.
 */
export function withEcho<T extends Record<string, DefaultValue>>(
  saved: T,
  echo: Record<string, string> | undefined,
): T {
  if (!echo) return saved
  const merged = { ...saved } as Record<string, DefaultValue>
  for (const key of Object.keys(saved)) {
    if (key in echo) merged[key] = echo[key]
  }
  return merged as T
}

export function NumberInput({
  name,
  defaultValue,
  unit,
  error,
  integer = false,
}: {
  name: string
  defaultValue: DefaultValue
  unit?: string
  error?: string
  integer?: boolean
}) {
  return (
    <div className="relative">
      <input
        id={name}
        name={name}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        defaultValue={defaultValue ?? ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`field tabular-nums ${unit ? 'pr-12' : ''}`}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-3">
          {unit}
        </span>
      ) : null}
    </div>
  )
}

export function TextInput({
  name,
  defaultValue,
  error,
  placeholder,
}: {
  name: string
  defaultValue: DefaultValue
  error?: string
  placeholder?: string
}) {
  return (
    <input
      id={name}
      name={name}
      type="text"
      defaultValue={defaultValue ?? ''}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${name}-error` : undefined}
      className="field"
    />
  )
}

export function TextArea({
  name,
  defaultValue,
  error,
  placeholder,
  rows = 4,
}: {
  name: string
  defaultValue: DefaultValue
  error?: string
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      id={name}
      name={name}
      rows={rows}
      defaultValue={defaultValue ?? ''}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${name}-error` : undefined}
      className="field"
    />
  )
}

export function Select({
  name,
  defaultValue,
  options,
  placeholder = 'Not set',
  error,
  onChange,
}: {
  name: string
  defaultValue: DefaultValue
  options: { value: string; label: string }[]
  placeholder?: string
  error?: string
  onChange?: (value: string) => void
}) {
  return (
    <select
      id={name}
      name={name}
      defaultValue={defaultValue ?? ''}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${name}-error` : undefined}
      className="field"
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * The primary button of a form. While the action runs it is disabled and its
 * label crossfades to the pending one, so the press is acknowledged at once
 * and cannot be sent twice.
 */
export function SubmitButton({
  children,
  pending: pendingLabel,
  variant = 'primary',
  size = 'normal',
  className = '',
}: {
  children: ReactNode
  pending: ReactNode
  /** One primary per screen; everything else is quiet. */
  variant?: 'primary' | 'quiet'
  size?: 'normal' | 'small'
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-quiet'} ${size === 'small' ? 'btn-small' : ''} grid justify-items-center disabled:cursor-progress disabled:opacity-100 ${className}`}
    >
      {/* Both labels share one grid cell, so the button is as wide as the
          longer of the two and the crossfade never changes its size. */}
      <span
        aria-hidden={pending || undefined}
        className={`[grid-area:1/1] transition-opacity duration-150 ease-out ${pending ? 'opacity-0' : 'opacity-100'}`}
      >
        {children}
      </span>
      <span
        aria-hidden={!pending}
        className={`flex items-center justify-center gap-2 whitespace-nowrap [grid-area:1/1] transition-opacity duration-150 ease-out ${pending ? 'opacity-100' : 'opacity-0'}`}
      >
        <Spinner />
        {pendingLabel}
      </span>
    </button>
  )
}

export function Spinner() {
  return (
    <svg className="spinner size-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * A line under a long-running button, shown only while its form is pending,
 * so a two-minute wait says what is happening instead of looking stuck.
 */
export function PendingNote({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <p aria-live="polite" className={`text-sm text-ink-3 transition-opacity duration-200 ease-out ${pending ? 'opacity-100' : 'opacity-0'}`}>
      {pending ? children : null}
    </p>
  )
}

export function FormMessage({ message }: { message: string | undefined }) {
  if (!message) return null
  return (
    <p role="alert" className="border-l-2 border-alert pl-3 text-sm text-ink">
      {message}
    </p>
  )
}
