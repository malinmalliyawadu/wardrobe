import Anthropic from '@anthropic-ai/sdk'

/**
 * One Claude client for the process. Credentials come from the environment
 * (ANTHROPIC_API_KEY) or an `ant auth login` profile; nothing is hardcoded.
 *
 * Model split, decided in docs/plan.md: the profile analysis, blueprint
 * drafting, looks, the outfit of the day and remaking a look run rarely (the
 * outfit once a day at most, a remake on his tap) and quality matters, so
 * they get Opus; scoring
 * runs over hundreds of products a night, and a photo of one of his clothes or
 * a find's cut before its try-on is a quick read, so those get Sonnet.
 */
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'

export const MODELS = {
  profile: OPUS,
  scoring: SONNET,
  piece: SONNET,
  cut: SONNET,
  looks: OPUS,
  day: OPUS,
  remake: OPUS,
} as const

/** List prices, USD per million tokens. */
export const PRICES = {
  [OPUS]: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  [SONNET]: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
} as const

/** What one call cost, from the usage it reported. */
export function callUsd(
  model: keyof typeof PRICES,
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null },
): number {
  const price = PRICES[model]
  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead) /
    1_000_000
  )
}

let client: Anthropic | undefined

export function claude(): Anthropic {
  client ??= new Anthropic()
  return client
}
