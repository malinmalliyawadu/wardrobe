import assert from 'node:assert/strict'
import { test } from 'node:test'

import Anthropic from '@anthropic-ai/sdk'

import { MODELS } from '../src/lib/claude.ts'
import type { Sql } from '../src/lib/db.ts'
import {
  buildScoreRequest,
  contextBlock,
  costUsd,
  plainText,
  scoreAll,
  ScoreSchema,
  tidyScore,
  type ProductForScoring,
  type ScoreOutput,
} from '../src/lib/finder/score.ts'
import type { Slot } from '../src/lib/blueprint.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

const output: ScoreOutput = {
  slot_id: 5,
  score: 84,
  colour: 'Pine',
  colour_verdict: 'Close to your pine.',
  fit_verdict: 'Slim through the body, set-in shoulder.',
  fabric_notes: 'Extra-fine merino.',
  why: 'Your pine — in a fine gauge that layers under the overshirt.',
  alternatives: [
    { slot_id: 13, score: 60 },
    { slot_id: 99, score: 70 },
  ],
}

const product: ProductForScoring = {
  product_id: 1,
  content_hash: 'abc',
  retailer: 'Barkers',
  title: 'Merino Crew Knit',
  vendor: 'Barkers',
  product_type: 'Knitwear',
  tags: ['knitwear', 'merino'],
  body_html: '<p>Extra-fine <strong>merino</strong>&nbsp;wool.</p><ul><li>Regular fit</li></ul>',
  images: [{ src: 'https://cdn.shopify.com/s/files/1/x/files/knit.jpg?v=123', width: 2000, height: 2500, alt: null }],
  colours: ['Pine', 'Navy'],
  sizes: ['S'],
  slot_ids: [5, 13],
}

test('the score schema accepts a verdict and refuses one out of range', () => {
  assert.ok(ScoreSchema.safeParse(output).success)
  assert.ok(ScoreSchema.safeParse({ ...output, slot_id: null, colour: null, alternatives: [] }).success)
  assert.ok(!ScoreSchema.safeParse({ ...output, score: 140 }).success)
  assert.ok(!ScoreSchema.safeParse({ ...output, score: 72.5 }).success)
  assert.ok(!ScoreSchema.safeParse({ ...output, why: undefined }).success)
})

test('tidying holds the verdict to the slots it was offered and the colours on sale', () => {
  const tidy = tidyScore(output, product)
  assert.equal(tidy.slot_id, 5)
  assert.deepEqual(tidy.alternatives, [{ slot_id: 13, score: 60 }], 'a slot it was not offered is dropped')
  assert.equal(tidy.why, 'Your pine - in a fine gauge that layers under the overshirt.')

  const stray = tidyScore({ ...output, slot_id: 99, score: 90, colour: 'Mustard' }, product)
  assert.equal(stray.slot_id, 13, 'an unoffered slot falls back to the best offered alternative')
  assert.equal(stray.score, 60, 'at that alternative score, not the unoffered one')
  assert.equal(stray.colour, null, 'a colour that is not on sale in his size is dropped')

  const none = tidyScore({ ...output, slot_id: null, alternatives: [] }, product)
  assert.equal(none.slot_id, null)
})

test('the request is Sonnet at low effort, with the run context cached and the product after it', () => {
  const slots = [{ id: 5, name: 'Pine fine-gauge merino crewneck', colours: ['#2f4a3a'] } as unknown as Slot]
  const context = contextBlock({ profile: profileFixture, guide: guideFixture, slots, dismissals: [] })
  assert.match(context, /Pine fine-gauge merino crewneck/)
  assert.match(context, /"name":"pine"/, 'slot colours carry their guide names')
  assert.doesNotMatch(context, /\n {2}"/, 'compact JSON: the context is read from the cache on every call')

  const request = buildScoreRequest(context, product)
  assert.equal(request.model, MODELS.scoring)
  assert.equal(request.output_config.effort, 'low')
  assert.equal(request.fallbacks, 'default')
  assert.equal(request.system.length, 2)
  assert.equal(request.system[0]!.cache_control, undefined)
  assert.deepEqual(request.system[1]!.cache_control, { type: 'ephemeral' }, 'the breakpoint sits on the run context')
  assert.equal(request.system[1]!.text, context)

  const [image, text] = request.messages[0]!.content
  assert.equal(image?.type, 'image')
  assert.ok(image?.type === 'image' && image.source.type === 'url')
  assert.equal(new URL(image.source.url).searchParams.get('width'), '768')
  assert.ok(text?.type === 'text')
  assert.match(text.text, /Slots it could fill by garment type: \[5,13\]/)
  assert.doesNotMatch(text.text, /price/i, 'price is the filter\'s business, and is not in the content hash')
})

test('cost follows Sonnet list prices, cache reads at a tenth', () => {
  assert.equal(costUsd({ input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }), 2)
  assert.equal(costUsd({ input: 0, output: 1_000_000, cacheWrite: 0, cacheRead: 0 }), 10)
  assert.equal(costUsd({ input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 1_000_000 }), 2.7)
})

test('descriptions reach Claude as plain text', () => {
  assert.equal(plainText(product.body_html), 'Extra-fine merino wool.\nRegular fit')
  assert.equal(plainText(null), '')
})

test('scoring stops after ten API errors in a row, and leaves the rest for the next run', async () => {
  const products = Array.from({ length: 40 }, (_, index) => ({ ...product, product_id: index + 1 }))
  let calls = 0
  const broke = new Anthropic.BadRequestError(400, { type: 'error' }, 'Your credit balance is too low', new Headers())
  const stats = await scoreAll({} as Sql, 1, 'context', products, {
    maxUsd: 10,
    concurrency: 1,
    log: () => {},
    save: async () => {},
    scoreOne: async () => {
      calls += 1
      if (calls <= 3) return { output, usage: { input: 1000, output: 100, cacheWrite: 0, cacheRead: 5000 }, servedBy: MODELS.scoring }
      throw broke
    },
  })
  assert.equal(stats.scored, 3)
  assert.equal(stats.failed, 10)
  assert.equal(stats.skipped_for_errors, 27)
  assert.match(stats.stopped ?? '', /^10 API errors in a row; the last: 400/)
  assert.equal(calls, 13, 'no call after the tenth error')
})

test('one odd product does not stop the run', async () => {
  const products = Array.from({ length: 30 }, (_, index) => ({ ...product, product_id: index + 1 }))
  let calls = 0
  const stats = await scoreAll({} as Sql, 1, 'context', products, {
    maxUsd: 10,
    concurrency: 2,
    log: () => {},
    save: async () => {},
    scoreOne: async () => {
      calls += 1
      if (calls % 3 === 0) throw new Anthropic.BadRequestError(400, { type: 'error' }, 'image could not be fetched', new Headers())
      return { output, usage: { input: 1000, output: 100, cacheWrite: 0, cacheRead: 5000 }, servedBy: MODELS.scoring }
    },
  })
  assert.equal(stats.stopped, null)
  assert.equal(stats.scored + stats.failed, 30)
})

test('a run that reaches its cap says how many it left, with every worker stopping', async () => {
  const products = Array.from({ length: 20 }, (_, index) => ({ ...product, product_id: index + 1 }))
  // Each score costs US$0.02 (10,000 fresh input tokens at $2 a million); the cap allows four.
  const stats = await scoreAll({} as Sql, 1, 'context', products, {
    maxUsd: 0.08,
    concurrency: 6,
    log: () => {},
    save: async () => {},
    scoreOne: async () => ({ output, usage: { input: 10_000, output: 0, cacheWrite: 0, cacheRead: 0 }, servedBy: MODELS.scoring }),
  })
  assert.ok(stats.scored >= 4, 'at least what the cap allows')
  assert.equal(stats.scored + stats.skipped_for_budget, 20, 'every product is either judged or counted as left')
  assert.ok(stats.skipped_for_budget > 0)
})
