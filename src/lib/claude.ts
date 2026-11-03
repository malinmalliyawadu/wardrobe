import Anthropic from '@anthropic-ai/sdk'

/**
 * One Claude client for the process. Credentials come from the environment
 * (ANTHROPIC_API_KEY) or an `ant auth login` profile; nothing is hardcoded.
 *
 * Model split, decided in docs/plan.md: the profile analysis and blueprint
 * drafting run rarely and quality matters, so they get Opus; scoring runs over
 * hundreds of products a night, so it gets Sonnet.
 */
export const MODELS = {
  profile: 'claude-opus-5-5',
  scoring: 'claude-sonnet-5-5',
} as const

let client: Anthropic | undefined

export function claude(): Anthropic {
  client ??= new Anthropic()
  return client
}
