import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { MODELS, claude } from './claude.ts'
import type { PhotoKind } from './photos.ts'
import {
  BUILDS,
  CONTRAST_LEVELS,
  NECK_LENGTHS,
  SEASONS,
  SHOULDER_HIP,
  SKIN_DEPTHS,
  TORSO_LEG,
  UNDERTONES,
} from './profile-values.ts'

/*
 * Claude's read of the photos. Every attribute carries the value, a 0 to 100
 * confidence and a one-sentence "why" written to Malin, so the confirm screen
 * can show the reasoning next to the choice he is asked to accept or correct.
 */

const confidence = z.number().int().min(0).max(100).describe('0 to 100')

function read<T extends z.ZodType>(value: T, why: string) {
  return z.object({
    value,
    confidence,
    why: z.string().describe(why),
  })
}

const WHY = 'One sentence to the client, second person, naming what in the photos led you here.'

export const AnalysisSchema = z.object({
  colouring: z.object({
    undertone: read(z.enum(UNDERTONES), WHY),
    skin_depth: read(z.enum(SKIN_DEPTHS), WHY),
    hair_colour: read(z.string().describe('Short, e.g. "dark brown with some grey"'), WHY),
    hair_texture: read(z.string().describe('Short, e.g. "thick, wavy"'), WHY),
    eye_colour: read(z.string().describe('Short, e.g. "dark brown"'), WHY),
    contrast_level: read(
      z.enum(CONTRAST_LEVELS).describe('Contrast between hair, skin and eyes'),
      WHY,
    ),
    season: read(z.enum(SEASONS).describe('Twelve-season placement'), WHY),
    runner_up_season: z
      .enum(SEASONS)
      .nullable()
      .describe('The next most likely season, or null if the placement is clear'),
  }),
  proportions: z.object({
    build: read(z.enum(BUILDS), WHY),
    shoulder_hip: read(z.enum(SHOULDER_HIP), WHY),
    torso_leg: read(z.enum(TORSO_LEG), WHY),
    neck_length: read(z.enum(NECK_LENGTHS), WHY),
  }),
  photo_notes: z
    .array(z.string())
    .describe(
      'Caveats about the photos themselves: lighting, white balance, filters, distance, clothing colour casting onto the face. Empty if none.',
    ),
  summary: z
    .string()
    .describe('Two or three sentences to the client summarising the read and what it means for clothes.'),
})

export type Analysis = z.infer<typeof AnalysisSchema>

export type StoredAnalysis = Analysis & {
  meta: {
    model: string
    served_by: string
    photo_ids: number[]
    input_tokens: number
    output_tokens: number
    analysed_at: string
  }
}

export class AnalysisError extends Error {}

export const SYSTEM_PROMPT = `You are an experienced personal stylist doing a seasonal colour analysis and a proportion read for one male client, from photos of himself that he supplied for exactly this purpose. The results feed a private app that drafts his wardrobe and finds clothes for him in Wellington, New Zealand.

Give your honest professional read, the way you would across a table from him. He will confirm or correct each point, so say what you actually see and how sure you are.

Colouring. Judge undertone from the skin at the jaw and neck, the colour of any visible veins, how the skin sits against any white or neutral fabric in frame, and how it reacts to warm or cool colours in the photo. Judge depth from overall skin value. Judge contrast from the difference in value between hair, skin and eyes. Place him in the twelve-season system (bright, true and light spring; light, true and soft summer; soft, true and deep autumn; deep, true and bright winter). Olive skin often reads neutral-cool in value and warm in hue; say so if that is what you see. Grey or greying hair lowers contrast and can shift a placement toward the soft seasons; account for it. If he has a visible tan, read the colouring he would have most of the year, not the holiday version.

The season is the call everything downstream is built on, and the useful part of it is the comparison. Name the runner-up whenever it is a real contender. The season "why" must say what places him in your pick rather than the runner-up, in terms of the dimension that separates them (warmth, depth or clarity), not restate his hair, skin and eyes.

Proportions. Use the full-length photos and the stated height. Build is the overall frame. Shoulder to hip is the width relationship. Torso to leg is where the natural waist and crotch sit relative to total height. Neck length is relative to head and shoulders.

Photos. Phone photos lie: warm indoor light, mixed light, a strong white balance shift, a filter, or a coloured top casting onto the face all move the read. Note every caveat you see in photo_notes and lower your confidence accordingly rather than guessing with false precision. When one photo is under strongly coloured light, take colouring from the other and say so.

Summary. It sits at the top of his profile in large type, so keep it under 70 words. Base clothing advice only on calls you hold at 60 or above; a tentative call is not a rule. If the season or undertone is below 70, make the last sentence the one daylight test at home that would settle it, in a short sentence (for example, a pure white against a cream tee at the jaw).

Write every "why" to him in the second person, in plain English, naming the specific thing in the photos that led you there. Do not identify him, do not describe his face in any way beyond what the fields ask for, and do not comment on attractiveness.`

/** Which stored photos get sent. References are taste, not colouring. */
export const ANALYSIS_KINDS: PhotoKind[] = ['face', 'full_body']

export function buildMessages(
  photos: { kind: PhotoKind; base64: string }[],
  heightCm: number | null,
): Anthropic.Beta.BetaMessageParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  for (const photo of photos) {
    content.push({
      type: 'text',
      text: photo.kind === 'face' ? 'Face photo:' : 'Full-length photo:',
    })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: photo.base64 },
    })
  }
  content.push({
    type: 'text',
    text: [
      heightCm ? `The client is ${heightCm} cm tall.` : 'Height not given.',
      `${photos.filter((p) => p.kind === 'face').length} face photo(s) and ${photos.filter((p) => p.kind === 'full_body').length} full-length photo(s) above.`,
      'Give your read.',
    ].join(' '),
  })
  return [{ role: 'user', content }]
}

/**
 * One call to Claude. Opus, because this runs once and the whole blueprint is
 * built on it. Effort high for the same reason. Server-side fallback is on so
 * a classifier decline is retried on another model inside the same request;
 * if the whole chain declines, the stop reason says so and we surface it.
 */
export async function analysePhotos(
  photos: { id: number; kind: PhotoKind; base64: string }[],
  heightCm: number | null,
): Promise<StoredAnalysis> {
  if (!photos.some((p) => p.kind === 'face')) {
    throw new AnalysisError('Add at least one face photo first.')
  }

  const response = await claude().beta.messages.parse({
    model: MODELS.profile,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: buildMessages(photos, heightCm),
    output_config: {
      effort: 'high',
      format: zodOutputFormat(AnalysisSchema),
    },
  })

  if (response.stop_reason === 'refusal') {
    const explanation = response.stop_details?.type === 'refusal' ? response.stop_details.explanation : null
    throw new AnalysisError(
      `Claude declined to read these photos${explanation ? `: ${explanation}` : '.'}`,
    )
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AnalysisError('The read was cut off. Try again.')
  }
  if (!response.parsed_output) {
    throw new AnalysisError('Claude answered in a shape the app did not expect. Try again.')
  }

  return {
    ...response.parsed_output,
    meta: {
      model: MODELS.profile,
      served_by: response.model,
      photo_ids: photos.map((p) => p.id),
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      analysed_at: new Date().toISOString(),
    },
  }
}

/** Read a stored analysis back out of the jsonb column, or null if absent or stale in shape. */
export function parseStoredAnalysis(value: unknown): StoredAnalysis | null {
  if (!value || typeof value !== 'object') return null
  const result = AnalysisSchema.safeParse(value)
  if (!result.success) return null
  const meta = (value as { meta?: StoredAnalysis['meta'] }).meta
  if (!meta) return null
  return { ...result.data, meta }
}
