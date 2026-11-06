import Anthropic from '@anthropic-ai/sdk'

import { MODELS, claude } from './claude.ts'
import { db } from './db.ts'
import { checkFiles } from './storage.ts'

export type Check = {
  name: string
  ok: boolean
  detail: string
  latencyMs: number
}

/**
 * The things the app cannot work without. Each check is independent and
 * never throws: a failure is a result, so the health page and the CLI can
 * show both at once.
 */
export async function checkDatabase(): Promise<Check> {
  const started = performance.now()
  try {
    const [row] = await db()<{ name: string; migrations: number }[]>`
      select current_database() as name,
             (select count(*)::int from schema_migrations) as migrations
    `
    return {
      name: 'Database',
      ok: true,
      detail: `${row?.name ?? 'unknown'}, ${plural(row?.migrations ?? 0, 'migration')} applied`,
      latencyMs: elapsed(started),
    }
  } catch (error) {
    return {
      name: 'Database',
      ok: false,
      detail: message(error),
      latencyMs: elapsed(started),
    }
  }
}

export async function checkClaude(): Promise<Check> {
  const started = performance.now()
  try {
    // Model lookup costs no tokens and proves the credentials and the model id.
    const model = await claude().models.retrieve(MODELS.profile)
    return {
      name: 'Claude',
      ok: true,
      detail: `${model.display_name} reachable`,
      latencyMs: elapsed(started),
    }
  } catch (error) {
    return {
      name: 'Claude',
      ok: false,
      detail: claudeMessage(error),
      latencyMs: elapsed(started),
    }
  }
}

/**
 * Whether uploads and try-ons can be written: R2 in production, the folder in
 * dev. See checkFiles for what counts as a failure.
 */
export async function checkPhotos(): Promise<Check> {
  const started = performance.now()
  const { ok, detail } = await checkFiles()
  return { name: 'Photos', ok, detail, latencyMs: elapsed(started) }
}

export async function checkAll(): Promise<Check[]> {
  return Promise.all([checkDatabase(), checkClaude(), checkPhotos()])
}

function claudeMessage(error: unknown): string {
  // Thrown by the client constructor, before any request, when nothing in the
  // environment identifies us.
  if (error instanceof Error && /authentication method/i.test(error.message)) {
    return 'No credentials. Set ANTHROPIC_API_KEY in .env or run `ant auth login`.'
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Credentials rejected. Set ANTHROPIC_API_KEY.'
  }
  if (error instanceof Anthropic.NotFoundError) {
    return `Model ${MODELS.profile} not found.`
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Rate limited.'
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the API.'
  }
  if (error instanceof Anthropic.APIError) {
    return `API error ${error.status}: ${error.message}`
  }
  return message(error)
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started)
}
