/**
 * What a form's Server Action returns to `useActionState`. Shared by every
 * action file so the forms and the actions agree on one shape.
 */
export type ActionState = {
  ok: boolean
  message?: string
  errors?: Record<string, string>
  /**
   * What was submitted, echoed back on a validation error. React 19 resets a
   * form once its action returns, so without this every other field would be
   * wiped while the user fixes the one that was wrong.
   */
  values?: Record<string, string>
} | null

/**
 * The submitted fields as strings. A field posted more than once (a group of
 * checkboxes) is joined with commas, so the form can split it back out.
 */
export function echo(form: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue
    values[key] = key in values ? `${values[key]},${value}` : value
  }
  return values
}
