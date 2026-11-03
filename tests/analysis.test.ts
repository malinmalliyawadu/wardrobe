import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AnalysisSchema, buildMessages, parseStoredAnalysis } from '../src/lib/analysis.ts'

const read = (value: string) => ({ value, confidence: 70, why: 'Because of the photo.' })

const fixture = {
  colouring: {
    undertone: read('warm'),
    skin_depth: read('medium'),
    hair_colour: read('dark brown'),
    hair_texture: read('thick, straight'),
    eye_colour: read('dark brown'),
    contrast_level: read('high'),
    season: read('deep autumn'),
    runner_up_season: 'deep winter',
  },
  proportions: {
    build: read('athletic'),
    shoulder_hip: read('shoulders_wider'),
    torso_leg: read('balanced'),
    neck_length: read('average'),
  },
  photo_notes: ['Warm indoor light in the face photo.'],
  summary: 'A deep autumn with high contrast.',
}

test('the schema accepts a complete read and rejects an unknown season', () => {
  assert.ok(AnalysisSchema.safeParse(fixture).success)
  const bad = structuredClone(fixture)
  bad.colouring.season.value = 'monsoon'
  assert.ok(!AnalysisSchema.safeParse(bad).success)
})

test('stored analyses round-trip, and anything else reads as null', () => {
  const stored = { ...fixture, meta: { model: 'm', served_by: 'm', photo_ids: [1], input_tokens: 1, output_tokens: 1, analysed_at: 'now' } }
  assert.deepEqual(parseStoredAnalysis(stored), stored)
  assert.equal(parseStoredAnalysis(null), null)
  assert.equal(parseStoredAnalysis({ hello: 'world' }), null)
  assert.equal(parseStoredAnalysis(fixture), null, 'no meta means not a stored analysis')
})

test('messages carry every photo as a labelled image and end with the height', () => {
  const messages = buildMessages(
    [
      { kind: 'face', base64: 'AAAA' },
      { kind: 'full_body', base64: 'BBBB' },
    ],
    183,
  )
  assert.equal(messages.length, 1)
  const content = messages[0]?.content
  assert.ok(Array.isArray(content))
  const images = content.filter((block) => block.type === 'image')
  assert.equal(images.length, 2)
  const last = content.at(-1)
  assert.ok(last && last.type === 'text' && /183 cm/.test(last.text))
  assert.ok(content[0]?.type === 'text' && /Face photo/.test(content[0].text))
})
