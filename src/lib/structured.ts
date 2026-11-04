import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'

import { MODELS, claude } from './claude.ts'

/*
 * One Opus call with a structured output, for the rare, quality-sensitive
 * generations (style guide, blueprint, refills). Same contract as the photo
 * read in analysis.ts: Opus at high effort, server-side fallback on, refusals
 * and truncation surfaced as a GenerationError the action can show.
 *
 * It streams, because a whole blueprint at high effort can outrun a
 * non-streaming request's timeout. The JSON is parsed here rather than by the
 * SDK so a refusal or a cut-off answer is reported as one, instead of as a
 * JSON syntax error from half an object.
 */

export class GenerationError extends Error {}

export type GenerationMeta = {
  model: string
  served_by: string
  input_tokens: number
  output_tokens: number
  generated_at: string
}

export async function generate<T extends z.ZodType>(options: {
  schema: T
  system: string
  messages: Anthropic.Beta.BetaMessageParam[]
  maxTokens: number
  /** Names the thing in error messages: "style guide", "blueprint". */
  what: string
  /** An Opus model from MODELS; the profile's unless the call names its own. */
  model?: typeof MODELS.profile
}): Promise<{ data: z.infer<T>; meta: GenerationMeta }> {
  const model = options.model ?? MODELS.profile
  // Without `parse`, the SDK passes the schema through but leaves the text alone.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parse: _parse, ...format } = zodOutputFormat(options.schema)

  const response = await claude()
    .beta.messages.stream({
      model,
      max_tokens: options.maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: options.system,
      messages: options.messages,
      output_config: { effort: 'high', format },
    })
    .finalMessage()

  if (response.stop_reason === 'refusal') {
    const explanation = response.stop_details?.type === 'refusal' ? response.stop_details.explanation : null
    throw new GenerationError(`Claude declined to draft the ${options.what}${explanation ? `: ${explanation}` : '.'}`)
  }
  if (response.stop_reason === 'max_tokens') {
    throw new GenerationError(`The ${options.what} was cut off before it was finished. Try again.`)
  }

  const parsed = options.schema.safeParse(plainDashes(parseJson(finalText(response.content))))
  if (!parsed.success) {
    throw new GenerationError(`Claude answered in a shape the app did not expect. Try again.`, {
      cause: parsed.error.issues.slice(0, 5),
    })
  }

  return {
    data: parsed.data,
    meta: {
      model,
      served_by: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      generated_at: new Date().toISOString(),
    },
  }
}

/**
 * The answer is the text after the last fallback hop. A model that declined
 * part way can leave text before its fallback block; that is not the answer.
 */
export function finalText(content: Anthropic.Beta.BetaContentBlock[]): string {
  const lastHop = content.findLastIndex((block) => block.type === 'fallback')
  return content
    .slice(lastHop + 1)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
}

/**
 * The app's copy uses a plain hyphen, never an en or em dash ("25-28 cm",
 * "a soft shoulder - no padding"). Applied to every string Claude returns.
 */
export function plainDashes(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\s*\u2014\s*/g, ' - ').replace(/\u2013/g, '-')
  if (Array.isArray(value)) return value.map(plainDashes)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plainDashes(inner)]))
  }
  return value
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
