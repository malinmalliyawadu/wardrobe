import { z } from 'zod'

/*
 * FormData parsing shared by every form. Empty strings mean "not given" and
 * become null; numbers are parsed leniently ("102", "102.5", " 102 ") and then
 * validated by the schema, which returns one message per bad field.
 */

export type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> }

export function text(form: FormData, name: string): string | null {
  const value = form.get(name)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function number(form: FormData, name: string): number | null | 'invalid' {
  const raw = text(form, name)
  if (raw === null) return null
  const value = Number(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : 'invalid'
}

/** "merino, lambswool ,, cotton" -> ["merino", "lambswool", "cotton"] */
export function list(form: FormData, name: string): string[] {
  const raw = text(form, name)
  if (raw === null) return []
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

export function finish<T>(schema: z.ZodType<T>, candidate: Record<string, unknown>): ParseResult<T> {
  const invalid = Object.entries(candidate).filter(([, value]) => value === 'invalid')
  if (invalid.length > 0) {
    return { ok: false, errors: Object.fromEntries(invalid.map(([key]) => [key, 'Enter a number'])) }
  }
  const result = schema.safeParse(candidate)
  if (result.success) return { ok: true, data: result.data }
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : 'form'
    errors[key] ??= issueMessage(issue)
  }
  return { ok: false, errors }
}

export function issueMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string' ? 'Fill this in' : `At least ${issue.minimum}`
    case 'too_big':
      return issue.origin === 'string' ? `At most ${issue.maximum} characters` : `At most ${issue.maximum}`
    case 'invalid_value':
      return 'Pick one of the options'
    case 'custom':
      return issue.message
    default:
      return 'Check this value'
  }
}

/**
 * Repeating rows posted as `prefix.index.field` (best.0.hex, best.0.name, ...).
 * Returns them in index order with every field trimmed, and drops rows the
 * user left entirely blank, so an empty trailing row is never an error. Each
 * row keeps the index it was posted with, so an error can name the field the
 * user actually sees.
 */
export type Row<F extends string> = { index: number; values: Record<F, string> }

export function rows<F extends string>(form: FormData, prefix: string, fields: readonly F[]): Row<F>[] {
  const byIndex = new Map<number, Record<F, string>>()
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue
    const parts = key.split('.')
    if (parts.length !== 3 || parts[0] !== prefix) continue
    const index = Number(parts[1])
    const field = parts[2] as F
    if (!Number.isInteger(index) || index < 0 || !fields.includes(field)) continue
    const row = byIndex.get(index) ?? (Object.fromEntries(fields.map((f) => [f, ''])) as Record<F, string>)
    row[field] = value.trim()
    byIndex.set(index, row)
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, values]) => ({ index, values }))
    .filter((row) => fields.some((field) => row.values[field] !== ''))
}
