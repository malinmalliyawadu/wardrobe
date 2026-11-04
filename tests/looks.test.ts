import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import {
  actOnLook,
  buildLooksMessages,
  readHistory,
  readiness,
  readLooks,
  saveSet,
  tidyLooks,
  wellingtonToday,
  type LookDraft,
} from '../src/lib/looks.ts'
import { createPiece, deletePiece, listPieces, setAside, type Piece } from '../src/lib/pieces.ts'
import { plainDashes } from '../src/lib/structured.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

/*
 * Looks: the rules a look is held to, the prompt, then a set saved, read and
 * acted on against a real Postgres in a scratch database (never the one
 * DATABASE_URL names). Opus is never called; its answer is a fixture.
 */

type Shelf = Pick<Piece, 'id' | 'garment_type' | 'set_aside_at'>
const shelf: Shelf[] = [
  { id: 1, garment_type: 'coat', set_aside_at: null },
  { id: 2, garment_type: 'knitwear', set_aside_at: null },
  { id: 3, garment_type: 'shirt', set_aside_at: null },
  { id: 4, garment_type: 'trousers', set_aside_at: null },
  { id: 5, garment_type: 'jeans', set_aside_at: null },
  { id: 6, garment_type: 'boots', set_aside_at: null },
  { id: 7, garment_type: 'sneakers', set_aside_at: null },
  { id: 8, garment_type: 'accessory', set_aside_at: null },
  { id: 9, garment_type: 'tee', set_aside_at: new Date() },
  { id: 10, garment_type: 'jacket', set_aside_at: null },
]

const look = (piece_ids: number[], extra: Partial<LookDraft> = {}): LookDraft => ({
  title: ' Navy and oxblood ',
  occasion: 'office',
  weather: 'mild',
  piece_ids,
  why: 'Because.',
  styling: null,
  better_with: null,
  ...extra,
})

const noHistory = { saved: [], dismissed: [] }

describe('the pure parts', () => {
  test('a look is put in layer order: outermost first, then down to the shoes, then what is carried', () => {
    const [tidied] = tidyLooks([look([6, 8, 4, 3, 2, 1])], shelf, [], noHistory)
    assert.deepEqual(tidied?.piece_ids, [1, 2, 3, 4, 6, 8])
    assert.equal(tidied?.title, 'Navy and oxblood')
  })

  test('a look that is not a whole outfit is dropped, not shown half right', () => {
    const kept = tidyLooks(
      [
        look([3, 4]), // no shoes
        look([3, 6]), // no trousers
        look([4, 6, 8]), // no top
        look([3, 4, 5, 6]), // two pairs of trousers
        look([3, 4, 6, 7]), // two pairs of shoes
        look([1, 10, 3, 4, 6]), // a coat and a jacket
        look([9, 4, 6]), // its only top is set aside
        look([3, 4, 6, 99]), // an unknown piece is dropped, the rest stands
      ],
      shelf,
      [],
      noHistory,
    )
    assert.deepEqual(kept.map((l) => l.piece_ids), [[3, 4, 6]])
  })

  test('a look is not repeated within the set or from his history, whatever the order', () => {
    const kept = tidyLooks([look([3, 4, 6]), look([6, 4, 3]), look([2, 5, 7])], shelf, [], {
      saved: [],
      dismissed: [{ title: 'x', piece_ids: [7, 5, 2], reason: 'colours' }],
    })
    assert.deepEqual(kept.map((l) => l.piece_ids), [[3, 4, 6]])
  })

  test('better_with survives only for a slot he still wants', () => {
    const [kept, dropped] = tidyLooks(
      [look([3, 4, 6], { better_with: { slot_id: 20, why: 'a scarf' } }), look([2, 5, 7], { better_with: { slot_id: 21, why: 'x' } })],
      shelf,
      [{ id: 20 }],
      noHistory,
    )
    assert.deepEqual(kept?.better_with, { slot_id: 20, why: 'a scarf' })
    assert.equal(dropped?.better_with, null)
  })

  test('readiness asks for two tops, trousers and shoes, and says what is missing in words', () => {
    assert.deepEqual(readiness([]), { ready: false, missing: ['two tops', 'a pair of trousers or jeans', 'a pair of shoes'] })
    assert.deepEqual(readiness(shelf.filter((piece) => [3, 4, 6, 9].includes(piece.id))), { ready: false, missing: ['one more top'] })
    assert.equal(readiness(shelf).ready, true)
  })

  test('the weather is Wellington’s for the month, in New Zealand time', () => {
    // 11pm on 31 October in UTC is already November in Wellington.
    const today = wellingtonToday(new Date('2026-10-31T23:00:00Z'))
    assert.equal(today.date, '2026-11-01')
    assert.equal(today.month, 'November')
    assert.match(today.weather, /11 to 17 degrees/)
  })

  test('the prompt carries the pieces as words, leaves out set-aside and activewear, and has no long dashes', () => {
    const pieces = [
      { id: 1, name: 'Ink coat', garment_type: 'coat', colour_hex: '#2f4a3a', colour_name: null, fabric: 'wool', fit: null, warmth: 'warm', notes: null, set_aside_at: null },
      { id: 2, name: 'Old tee', garment_type: 'tee', colour_hex: null, colour_name: 'grey', fabric: null, fit: null, warmth: null, notes: null, set_aside_at: new Date() },
      { id: 3, name: 'Gym shorts', garment_type: 'activewear', colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, notes: null, set_aside_at: null },
    ] as Piece[]
    const [message] = buildLooksMessages({
      profile: profileFixture,
      guide: guideFixture,
      pieces,
      wanted: [{ id: 7, name: 'Oxblood scarf', garment_type: 'accessory', status: 'wanted' }],
      history: { saved: [], dismissed: [], worn: new Map([[1, 2]]) },
      note: 'a wedding',
      now: new Date('2026-11-04T00:00:00Z'),
    })
    const content = message!.content as string
    assert.match(content, /"name": "Ink coat"/)
    assert.match(content, /"name": "pine"/, 'the guide name for the hex')
    assert.match(content, /"worn_lately": 2/)
    assert.doesNotMatch(content, /Old tee|Gym shorts/)
    assert.match(content, /He asked for this set: "a wedding"/)
    assert.doesNotMatch(content, /[–—]/)
    assert.equal(plainDashes('tuck it — then cuff'), 'tuck it - then cuff')
  })
})

describe('a set saved, read and acted on', () => {
  const scratch = `wardrobe_looks_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  const ids: number[] = []

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the looks test')
    admin = connect({ max: 1 })
    await admin.unsafe(`create database ${scratch}`)
    const url = new URL(process.env.DATABASE_URL)
    url.pathname = `/${scratch}`
    execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
    process.env.DATABASE_URL = url.toString()
    sql = connect({ max: 2 })
    const typed = { source: 'typed' as const, photo_id: null, product_id: null }
    for (const [name, garment_type] of [
      ['Ecru oxford', 'shirt'],
      ['Pine crew', 'knitwear'],
      ['Putty chinos', 'trousers'],
      ['Brown Chelseas', 'boots'],
    ] as const) {
      ids.push(
        await createPiece(
          { name, garment_type, colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, brand: null, size: null, notes: null, slot_id: null },
          typed,
        ),
      )
    }
  })

  after(async () => {
    await sql?.end()
    await db().end()
    await admin.unsafe(`drop database if exists ${scratch} with (force)`)
    await admin.end()
  })

  const draft = (lookIds: number[][]) => ({
    looks: lookIds.map((piece_ids, index) => ({ ...look(piece_ids), title: `Look ${index + 1}` })),
    proposed: lookIds.length,
    meta: { model: 'claude-opus-5-5', served_by: 'claude-opus-5-5', input_tokens: 10_000, output_tokens: 5_000, generated_at: '' },
    usd: 0.14,
  })

  test('the newest set shows less what he dismissed; saved and worn looks stay put, and teach the next set', async () => {
    const [shirt, crew, chinos, boots] = ids as [number, number, number, number]
    await saveSet(draft([[shirt, chinos, boots], [crew, shirt, chinos, boots], [crew, chinos, boots]]), { note: null, pieces: 4, date: '2026-11-04', weather: 'mild' })
    let page = await readLooks()
    assert.deepEqual(page.fresh.map((l) => l.title), ['Look 1', 'Look 2', 'Look 3'])
    assert.deepEqual(page.fresh[0]?.pieces.map((p) => p.name), ['Ecru oxford', 'Putty chinos', 'Brown Chelseas'])
    assert.deepEqual(page.total, { sets: 1, usd: 0.14 })

    const [first, second, third] = page.fresh.map((l) => ({ id: l.id })) as [{ id: number }, { id: number }, { id: number }]
    await actOnLook({ action: 'save', look_id: first.id })
    await actOnLook({ action: 'dismiss', look_id: second.id, reason: 'too_dressy' })
    await actOnLook({ action: 'wore', look_id: third.id })
    await actOnLook({ action: 'wore', look_id: third.id })

    page = await readLooks()
    assert.deepEqual(page.fresh.map((l) => [l.title, l.status]), [['Look 1', 'saved'], ['Look 3', 'saved']], 'saving does not move a card')
    assert.equal(page.fresh[1]?.worn.length, 1, 'worn once a day')

    const history = await readHistory()
    assert.equal(history.saved.length, 2)
    assert.deepEqual(history.dismissed.map((d) => d.reason), ['too_dressy'])
    assert.equal(history.worn.get(crew), 1)

    // The next set: the saved looks move to Saved, the rest of the old set is gone.
    await saveSet(draft([[shirt, chinos, boots]]), { note: 'cold', pieces: 4, date: '2026-11-05', weather: 'cold' })
    page = await readLooks()
    assert.deepEqual(page.saved.map((l) => l.title), ['Look 3', 'Look 1'], 'most recently worn first')
    assert.equal(page.latest?.note, 'cold')

    await actOnLook({ action: 'unwore', look_id: third.id })
    assert.equal((await readLooks()).saved.find((l) => l.title === 'Look 3')?.worn.length, 0)
  })

  test('a look says so when one of its pieces is set aside or deleted', async () => {
    const [, crew, chinos] = ids as [number, number, number, number]
    await setAside(crew, 'wanted')
    let saved = (await readLooks()).saved.find((l) => l.title === 'Look 3')
    assert.ok(saved?.pieces.some((piece) => piece.set_aside_at))
    await deletePiece(chinos)
    saved = (await readLooks()).saved.find((l) => l.title === 'Look 3')
    assert.equal(saved?.piece_count, 3)
    assert.equal(saved?.pieces.length, 2)
    assert.equal((await listPieces()).length, 3)
  })
})
