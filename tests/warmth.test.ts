import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Piece } from '../src/lib/pieces.ts'
import { pieceWarmth, WARMTH_RULES, warmthLimit, withinWarmth } from '../src/lib/warmth.ts'

/*
 * The day's warmth limit and a piece's warmth: what keeps the outfit of the
 * day from three layers and wool on a warm day.
 */

type Warmable = Pick<Piece, 'garment_type' | 'warmth' | 'fabric' | 'name'>
const piece = (garment_type: Warmable['garment_type'], name: string, extra: Partial<Warmable> = {}): Warmable => ({
  garment_type,
  name,
  fabric: null,
  warmth: null,
  ...extra,
})

describe('the warmth limit', () => {
  test('goes by the warmest the day feels', () => {
    assert.equal(warmthLimit(26).band, 'hot')
    assert.equal(warmthLimit(22).band, 'hot')
    assert.equal(warmthLimit(21).band, 'warm')
    assert.equal(warmthLimit(18).band, 'warm')
    assert.equal(warmthLimit(17).band, 'mild')
    assert.equal(warmthLimit(14).band, 'mild')
    assert.equal(warmthLimit(13).band, 'cold')
    assert.deepEqual(warmthLimit(23), { band: 'hot', feels_high: 23, most_layers: 2, most_warm_pieces: 0, ruled_out: ['knitwear', 'sweatshirt', 'coat'] })
  })

  test('the prompts state the same numbers code holds', () => {
    assert.match(WARMTH_RULES, /from 22°, at most two layers, nothing warm and no knitwear, sweatshirts or coats/)
    assert.match(WARMTH_RULES, /18° to 21°, at most two layers, nothing warm and no coats/)
    assert.match(WARMTH_RULES, /14° to 17°, at most three layers and at most one warm piece/)
    assert.match(WARMTH_RULES, /under 14°, what the day needs/)
  })

  test('counts layers on the body, not trousers, shoes or what is carried', () => {
    const outfit = [piece('tee', 'Cream tee'), piece('shirt', 'Blue linen shirt'), piece('trousers', 'Putty chinos'), piece('sneakers', 'White sneakers'), piece('belt', 'Tan belt')]
    assert.equal(withinWarmth(outfit, warmthLimit(25)), true)
    assert.equal(withinWarmth([piece('jacket', 'Navy rain shell'), ...outfit], warmthLimit(25)), false, 'a third layer')
    assert.equal(withinWarmth([piece('jacket', 'Navy rain shell'), ...outfit], warmthLimit(16)), true)
    assert.equal(withinWarmth([piece('jacket', 'Navy rain shell'), ...outfit], null), true, 'no limit')
  })

  test('a knit is ruled out on a hot day whatever it is made of, and a warm piece on a warm one', () => {
    const base = [piece('trousers', 'Putty chinos'), piece('shoes', 'Brown loafers')]
    assert.equal(withinWarmth([piece('knitwear', 'Ecru cotton crew', { warmth: 'light' }), ...base], warmthLimit(23)), false)
    assert.equal(withinWarmth([piece('knitwear', 'Ecru cotton crew'), ...base], warmthLimit(20)), true, 'a cotton knit is mid')
    assert.equal(withinWarmth([piece('knitwear', 'Pine merino crew'), ...base], warmthLimit(20)), false, 'merino is warm')
    assert.equal(withinWarmth([piece('knitwear', 'Pine merino crew'), piece('overshirt', 'Brown cord overshirt'), ...base], warmthLimit(15)), false, 'one warm piece on a mild day')
  })
})

describe("a piece's warmth", () => {
  test('is what he or the photo read said, when there is one', () => {
    assert.equal(pieceWarmth(piece('knitwear', 'Pine merino crew', { warmth: 'mid' })), 'mid')
  })

  test('is read from the garment and its cloth when there is none', () => {
    assert.equal(pieceWarmth(piece('tee', 'Navy merino tee')), 'light')
    assert.equal(pieceWarmth(piece('shirt', 'White oxford button-down')), 'light', 'a button-down is not down')
    assert.equal(pieceWarmth(piece('shirt', 'Red check flannel shirt')), 'mid')
    assert.equal(pieceWarmth(piece('knitwear', 'Navy crewneck', { fabric: 'lambswool' })), 'warm')
    assert.equal(pieceWarmth(piece('knitwear', 'Ecru cotton crew')), 'mid')
    assert.equal(pieceWarmth(piece('overshirt', 'Olive wool overshirt')), 'warm')
    assert.equal(pieceWarmth(piece('overshirt', 'Olive cotton overshirt')), 'mid')
    assert.equal(pieceWarmth(piece('jacket', 'Navy rain shell')), 'light')
    assert.equal(pieceWarmth(piece('jacket', 'Black puffer')), 'warm')
    assert.equal(pieceWarmth(piece('coat', 'Camel overcoat')), 'warm')
    assert.equal(pieceWarmth(piece('coat', 'Stone trench')), 'mid')
    assert.equal(pieceWarmth(piece('tailoring', 'Navy linen blazer')), 'light')
    assert.equal(pieceWarmth(piece('trousers', 'Brown cords')), 'warm')
    assert.equal(pieceWarmth(piece('trousers', 'Navy wool trousers')), 'mid', 'worsted is year round')
    assert.equal(pieceWarmth(piece('trousers', 'Ecru linen trousers')), 'light')
    assert.equal(pieceWarmth(piece('shorts', 'Navy shorts')), 'light')
    assert.equal(pieceWarmth(piece('boots', 'Brown suede boots')), null, 'shoes are not counted')
  })
})
