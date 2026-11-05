import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import {
  actOnLook,
  buildLooksMessages,
  gymReadiness,
  readHistory,
  readiness,
  readinessAround,
  readLooks,
  readPieceLooks,
  saveSet,
  tidyAround,
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

type Shelf = Pick<Piece, 'id' | 'garment_type' | 'set_aside_at' | 'worn_for'>
const everyday = (id: number, garment_type: Shelf['garment_type'], set_aside_at: Date | null = null): Shelf => ({
  id,
  garment_type,
  set_aside_at,
  worn_for: 'everyday',
})
const shelf: Shelf[] = [
  everyday(1, 'coat'),
  everyday(2, 'knitwear'),
  everyday(3, 'shirt'),
  everyday(4, 'trousers'),
  everyday(5, 'jeans'),
  everyday(6, 'boots'),
  everyday(7, 'sneakers'),
  everyday(8, 'accessory'),
  everyday(9, 'tee', new Date()),
  everyday(10, 'jacket'),
]

/** Gym kit: a tank and shorts for the gym only, a hoodie and trainers worn for both, and a piece still filed as activewear. */
const kit: Shelf[] = [
  { id: 21, garment_type: 'tank', set_aside_at: null, worn_for: 'gym' },
  { id: 22, garment_type: 'shorts', set_aside_at: null, worn_for: 'gym' },
  { id: 23, garment_type: 'sweatshirt', set_aside_at: null, worn_for: 'both' },
  { id: 24, garment_type: 'sneakers', set_aside_at: null, worn_for: 'both' },
  { id: 25, garment_type: 'activewear', set_aside_at: null, worn_for: 'gym' },
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

  test('gym kit does not make an everyday wardrobe ready; a piece worn for both counts in either', () => {
    const tank = kit.find((piece) => piece.id === 21)!
    const hoodie = kit.find((piece) => piece.id === 23)!
    assert.deepEqual(readiness([...shelf.filter((piece) => [3, 4, 6].includes(piece.id)), tank]).missing, ['one more top'])
    assert.equal(readiness([...shelf.filter((piece) => [3, 4, 6].includes(piece.id)), hoodie]).ready, true)
  })

  test('gym readiness asks for a top, shorts or joggers and trainers among the gym kit, activewear not counted', () => {
    assert.deepEqual(gymReadiness(shelf), { ready: false, missing: ['a top', 'shorts or joggers', 'trainers'] })
    assert.deepEqual(gymReadiness([...shelf, kit[4]!]).missing, ['a top', 'shorts or joggers', 'trainers'])
    assert.deepEqual(gymReadiness([...shelf, ...kit.filter((piece) => piece.id !== 22)]).missing, ['shorts or joggers'])
    assert.equal(gymReadiness(kit).ready, true)
  })

  test('a gym fit is made of gym kit only, and an everyday look leaves gym-only kit out', () => {
    const pieces = [...shelf, ...kit]
    const kept = tidyLooks(
      [
        look([23, 21, 22, 24], { occasion: 'gym' }), // hoodie, tank, shorts, trainers: whole
        look([21, 22, 6], { occasion: 'gym' }), // everyday boots are dropped: no shoes left
        look([21, 4, 24], { occasion: 'gym' }), // everyday trousers are dropped: no bottom left
        look([25, 22, 24], { occasion: 'gym' }), // activewear says nothing of what it is: no top left
        look([21, 3, 4, 6]), // the gym tank is dropped from an office look; the rest stands
        look([23, 4, 24]), // a piece worn for both goes in an everyday look
      ],
      pieces,
      [],
      noHistory,
    )
    assert.deepEqual(
      kept.map((l) => [l.occasion, l.piece_ids]),
      [
        ['gym', [23, 21, 22, 24]],
        ['office', [3, 4, 6]],
        ['office', [23, 4, 24]],
      ],
    )
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
      { id: 1, name: 'Ink coat', garment_type: 'coat', colour_hex: '#2f4a3a', colour_name: null, fabric: 'wool', fit: null, warmth: 'warm', worn_for: 'everyday', notes: null, set_aside_at: null },
      { id: 2, name: 'Old tee', garment_type: 'tee', colour_hex: null, colour_name: 'grey', fabric: null, fit: null, warmth: null, worn_for: 'everyday', notes: null, set_aside_at: new Date() },
      { id: 3, name: 'Gym shorts', garment_type: 'activewear', colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, worn_for: 'gym', notes: null, set_aside_at: null },
      { id: 4, name: 'Pine training tank', garment_type: 'tank', colour_hex: null, colour_name: 'pine', fabric: null, fit: null, warmth: 'light', worn_for: 'gym', notes: null, set_aside_at: null },
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
    assert.match(content, /"name": "Pine training tank",\s+"garment": "tank",\s+"worn_for": "gym"/)
    assert.match(content, /"kit_ready": false/)
    assert.match(content, /He asked for this set: "a wedding"/)
    assert.doesNotMatch(content, /[–—]/)
    assert.equal(plainDashes('tuck it — then cuff'), 'tuck it - then cuff')
  })

  test('a set of gym fits asks for gym fits only, with his gym days', () => {
    const [message] = buildLooksMessages({
      profile: { ...profileFixture, life: { gym: 4, gym_days: ['monday', 'tuesday', 'thursday', 'saturday'] } },
      guide: guideFixture,
      pieces: [],
      wanted: [],
      history: { saved: [], dismissed: [], worn: new Map() },
      note: null,
      kind: 'gym',
    })
    const content = message!.content as string
    assert.match(content, /"days_a_week": 4/)
    assert.match(content, /Make up to 6 gym fits from his gym kit/)
  })
})

describe('looks around a piece', () => {
  test('the ask names the piece, wants three ways to wear it, and carries his note', () => {
    const [message] = buildLooksMessages({
      profile: profileFixture,
      guide: guideFixture,
      pieces: [],
      wanted: [],
      history: { saved: [], dismissed: [], worn: new Map() },
      note: 'the office',
      around: { id: 12, name: 'Rust overshirt', worn_for: 'everyday' },
    })
    const content = message!.content as string
    assert.match(content, /"Rust overshirt" \(id 12\)/)
    assert.match(content, /Make 3 looks that each wear it/)
    assert.match(content, /He added: "the office"/)
    assert.doesNotMatch(content, /gym fit/)
    assert.doesNotMatch(content, /He asked for this set/)
  })

  test('gym kit is built on as gym fits', () => {
    const [message] = buildLooksMessages({
      profile: profileFixture,
      guide: guideFixture,
      pieces: [],
      wanted: [],
      history: { saved: [], dismissed: [], worn: new Map() },
      note: null,
      around: { id: 21, name: 'Pine tank', worn_for: 'gym' },
    })
    assert.match(message!.content as string, /It is gym kit, so they are gym fits/)
  })

  test('only looks that still wear the piece once tidied are kept, three at most', () => {
    // The coat is in every look Claude made, but the third repeats the second and the fifth is not whole.
    const tidied = tidyLooks(
      [look([1, 3, 4, 6]), look([1, 2, 5, 7]), look([7, 5, 2, 1]), look([2, 3, 4, 6]), look([1, 4, 6]), look([1, 3, 5, 6]), look([1, 2, 4, 7])],
      shelf,
      [],
      noHistory,
    )
    const kept = tidyAround(tidied, 1)
    assert.deepEqual(kept.map((l) => l.piece_ids), [[1, 3, 4, 6], [1, 2, 5, 7], [1, 3, 5, 6]])
    assert.equal(tidyAround(tidied, null).length, tidied.length, 'a set not around a piece is left alone')
  })

  test('a piece is ready to build on when a whole outfit of what it is worn for can be made', () => {
    assert.deepEqual(readinessAround({ worn_for: 'everyday' }, shelf), { ready: true, missing: [], gym: false })
    assert.deepEqual(readinessAround({ worn_for: 'gym' }, kit), { ready: true, missing: [], gym: true })
    assert.deepEqual(readinessAround({ worn_for: 'gym' }, shelf), { ready: false, missing: ['a top', 'shorts or joggers', 'trainers'], gym: true })
    // Worn for both: everyday looks when only those can be made, gym fits too when the kit is ready.
    assert.equal(readinessAround({ worn_for: 'both' }, shelf).ready, true)
    assert.equal(readinessAround({ worn_for: 'both' }, kit).gym, true)
    assert.deepEqual(readinessAround({ worn_for: 'both' }, []).missing, ['two tops', 'a pair of trousers or jeans', 'a pair of shoes'])
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
          { name, garment_type, colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, worn_for: 'everyday', brand: null, size: null, notes: null, slot_id: null },
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
    await saveSet(draft([[shirt, crew, boots]]), { note: 'cold', pieces: 4, date: '2026-11-05', weather: 'cold' })
    page = await readLooks()
    assert.deepEqual(page.saved.map((l) => l.title), ['Look 3', 'Look 1'], 'most recently worn first')
    assert.equal(page.latest?.note, 'cold')
    assert.equal(page.latest?.kind, 'week')

    // A set of gym fits says so.
    await saveSet({ ...draft([]), looks: [] }, { note: null, pieces: 4, date: '2026-11-05', weather: 'cold', kind: 'gym' })
    assert.equal((await readLooks()).latest?.kind, 'gym')

    await actOnLook({ action: 'unwore', look_id: third.id })
    assert.equal((await readLooks()).saved.find((l) => l.title === 'Look 3')?.worn.length, 0)
  })

  test('a set offers the look already made with the same pieces, not a copy; never one he dismissed', async () => {
    const [shirt, crew, chinos, boots] = ids as [number, number, number, number]
    const [cold] = await sql<{ id: number }[]>`
      select l.id::int as id from looks l join look_sets s on s.id = l.set_id where s.note = 'cold'
    `
    const count = async () => (await sql<{ count: number }[]>`select count(*)::int as count from looks`)[0]!.count
    const before = await count()
    await saveSet(draft([[boots, crew, shirt], [crew, shirt, chinos, boots], [shirt, chinos]]), { note: 'again', pieces: 4, date: '2026-11-06', weather: 'mild' })
    const page = await readLooks()
    assert.equal(page.latest?.note, 'again')
    assert.equal(page.fresh.length, 3, 'all three in the newest set, in order')
    assert.equal(page.fresh[0]?.id, cold!.id, 'the look the cold set made, in any order of pieces')
    assert.equal(page.fresh[0]?.title, 'Look 1', 'with its own words')
    assert.equal((await count()) - before, 2, 'the dismissed outfit and the new one are new looks')
  })

  test('looks around a piece are its own: the piece page shows the newest, the Looks tab does not', async () => {
    const [shirt, crew, chinos, boots] = ids as [number, number, number, number]
    const latest = (await readLooks()).latest
    assert.deepEqual(await readPieceLooks(crew), { latest: null, looks: [] })

    await saveSet(draft([[crew, chinos, boots], [crew, shirt, chinos, boots]]), { note: 'office', pieces: 4, date: '2026-11-06', weather: 'mild', pieceId: crew })
    await saveSet(draft([[crew, shirt, boots], [shirt, crew, chinos, boots]]), { note: null, pieces: 4, date: '2026-11-06', weather: 'mild', pieceId: crew })
    let around = await readPieceLooks(crew)
    assert.equal(around.latest?.note, null, 'the newest set around it')
    assert.equal(around.looks.length, 2)
    assert.equal(around.looks[1]?.status, 'new', 'the look an earlier set made, offered again')
    assert.deepEqual(await readPieceLooks(shirt), { latest: null, looks: [] }, 'only the piece it was made on')

    const page = await readLooks()
    assert.equal(page.latest?.id, latest?.id, 'the Looks tab keeps the newest set made there')

    await actOnLook({ action: 'dismiss', look_id: around.looks[0]!.id, reason: 'colours' })
    await actOnLook({ action: 'save', look_id: around.looks[1]!.id })
    around = await readPieceLooks(crew)
    assert.deepEqual(around.looks.map((l) => l.status), ['saved'], 'what he dismissed goes, what he saved stays')
    // The same outfit is in the Looks tab's newest set too, so it is saved there, where it was.
    const looksTab = await readLooks()
    assert.equal(looksTab.fresh.find((l) => l.id === around.looks[0]!.id)?.status, 'saved', 'one outfit, saved everywhere')
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
