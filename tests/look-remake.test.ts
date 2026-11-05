import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { readDay, saveDay } from '../src/lib/day-outfit.ts'
import {
  buildRemakeMessages,
  remakeProblem,
  runRemake,
  startRemake,
  tidyRemake,
  type RemakeDraft,
  type RemakeInput,
  type RemakeResult,
} from '../src/lib/look-remake.ts'
import { wholeWithout } from '../src/lib/look-rules.ts'
import { actOnLook, getLooks, readHistory, readLooks, saveSet } from '../src/lib/looks.ts'
import { createPiece, listPieces, type Piece } from '../src/lib/pieces.ts'
import { saveGuide } from '../src/lib/style-guide.ts'
import { dressDate } from '../src/lib/weather.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

/*
 * Remaking a look: what he may ask, what the remake is held to, the prompt,
 * then a look remade in its place against a real Postgres in a scratch
 * database (never the one DATABASE_URL names). Opus is never called; its
 * answer is a fixture.
 */

type Shelf = Pick<Piece, 'id' | 'name' | 'garment_type' | 'set_aside_at' | 'worn_for'>
const piece = (id: number, garment_type: Shelf['garment_type'], extra: Partial<Shelf> = {}): Shelf => ({
  id,
  name: `Piece ${id}`,
  garment_type,
  set_aside_at: null,
  worn_for: 'everyday',
  ...extra,
})
const shelf: Shelf[] = [
  piece(1, 'coat'),
  piece(2, 'knitwear'),
  piece(3, 'shirt'),
  piece(4, 'trousers'),
  piece(5, 'jeans'),
  piece(6, 'boots'),
  piece(7, 'sneakers'),
  piece(8, 'accessory'),
  piece(9, 'tee'),
  piece(21, 'tank', { worn_for: 'gym' }),
  piece(22, 'shorts', { worn_for: 'gym' }),
  piece(24, 'sneakers', { worn_for: 'both' }),
]
const of = (ids: number[]) => ids.map((id) => shelf.find((p) => p.id === id)!)

/** Coat, crew, oxford, chinos, boots and a scarf. */
const lookPieces = of([1, 2, 3, 4, 6, 8])
const theLook = { status: 'saved' as const, piece_count: lookPieces.length, pieces: lookPieces }

const draft = (piece_ids: number[], extra: Partial<RemakeDraft> = {}): RemakeDraft => ({
  title: ' Crew and white sneakers ',
  weather: 'mild and dry',
  piece_ids,
  why: 'Because.',
  styling: null,
  today: null,
  ...extra,
})

describe('the pure parts', () => {
  test('a piece can be removed only when the look stands without it', () => {
    assert.equal(wholeWithout(lookPieces, new Set([1])), true, 'the coat')
    assert.equal(wholeWithout(lookPieces, new Set([8])), true, 'the scarf')
    assert.equal(wholeWithout(lookPieces, new Set([2])), true, 'one of two tops')
    assert.equal(wholeWithout(lookPieces, new Set([2, 3])), false, 'both tops')
    assert.equal(wholeWithout(lookPieces, new Set([4])), false, 'the trousers')
    assert.equal(wholeWithout(lookPieces, new Set([6])), false, 'the shoes')
  })

  test('what he asks is checked before Opus is called, and answered in words', () => {
    assert.equal(remakeProblem(theLook, { swap: [6], remove: [1] }), null)
    assert.equal(remakeProblem(theLook, { swap: [], remove: [] }), 'Mark a piece to swap or remove first.')
    assert.match(remakeProblem(theLook, { swap: [5], remove: [] }) ?? '', /changed/, 'not a piece of the look')
    assert.match(remakeProblem(theLook, { swap: [6], remove: [6] }) ?? '', /changed/, 'swapped and removed at once')
    assert.match(remakeProblem(theLook, { swap: [], remove: [4] }) ?? '', /not a whole outfit/)
    assert.equal(remakeProblem({ ...theLook, status: 'replaced' }, { swap: [6], remove: [] }), 'This look has gone.')
    assert.match(remakeProblem({ ...theLook, piece_count: 7 }, { swap: [6], remove: [] }) ?? '', /no longer in your wardrobe/)
    const aside = { ...theLook, pieces: lookPieces.map((p) => (p.id === 2 ? { ...p, set_aside_at: new Date() } : p)) }
    assert.equal(remakeProblem(aside, { swap: [6], remove: [] }), 'Piece 2 is set aside. Swap or remove it too.')
    assert.equal(remakeProblem(aside, { swap: [6], remove: [2] }), null)
  })

  const original = { occasion: 'office' as const, piece_ids: [1, 2, 3, 4, 6, 8] }
  const none = { dismissed: [] }

  test('the remake keeps every piece he kept, in layer order, with one new piece for the one he swapped', () => {
    const tidy = tidyRemake(draft([7, 4, 3, 2, 1]), original, { swap: [6], remove: [8] }, shelf, none)
    assert.deepEqual(tidy, {
      title: 'Crew and white sneakers',
      occasion: 'office',
      weather: 'mild and dry',
      piece_ids: [1, 2, 3, 4, 7],
      why: 'Because.',
      styling: null,
      today: null,
    })
  })

  test('a remake that drops a kept piece, brings back a marked one, or adds more than he swapped is not kept', () => {
    const ask = { swap: [6], remove: [1] }
    assert.equal(tidyRemake(draft([2, 4, 7, 8]), original, ask, shelf, none), null, 'the oxford is gone')
    assert.equal(tidyRemake(draft([1, 2, 3, 4, 7, 8]), original, ask, shelf, none), null, 'the coat came back')
    assert.equal(tidyRemake(draft([2, 3, 4, 6, 8]), original, ask, shelf, none), null, 'the boots stayed')
    assert.equal(tidyRemake(draft([2, 3, 4, 7, 8, 9]), original, ask, shelf, none), null, 'a tee came in as well')
    assert.notEqual(tidyRemake(draft([2, 3, 4, 7, 8]), original, ask, shelf, none), null)
  })

  test('a removal adds nothing, and a remake is still a whole look and not one he dismissed', () => {
    assert.notEqual(tidyRemake(draft([2, 3, 4, 6]), original, { swap: [], remove: [1, 8] }, shelf, none), null)
    assert.equal(tidyRemake(draft([2, 3, 4, 6, 9]), original, { swap: [], remove: [1, 8] }, shelf, none), null, 'a tee added')
    assert.equal(tidyRemake(draft([2, 3, 4, 5, 6, 8]), original, { swap: [1], remove: [] }, shelf, none), null, 'two pairs of trousers')
    const dismissed = { dismissed: [{ title: 'x', piece_ids: [2, 3, 4, 6], reason: 'colours' as const }] }
    assert.equal(tidyRemake(draft([2, 3, 4, 6]), original, { swap: [], remove: [1, 8] }, shelf, dismissed), null)
  })

  test('a gym fit is remade from gym kit only', () => {
    const gym = { occasion: 'gym' as const, piece_ids: [21, 22, 24] }
    assert.equal(tidyRemake(draft([21, 22, 7]), gym, { swap: [24], remove: [] }, shelf, none), null, 'everyday sneakers')
    assert.equal(tidyRemake(draft([9, 22, 24]), gym, { swap: [21], remove: [] }, shelf, none), null, 'an everyday tee')
    assert.equal(tidyRemake(draft([21, 22, 24], { title: 'Same' }), gym, { swap: [], remove: [] }, shelf, none)?.occasion, 'gym')
  })
})

describe('a look remade in its place', () => {
  const scratch = `wardrobe_remake_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  const ids: Record<string, number> = {}

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the remake test')
    admin = connect({ max: 1 })
    await admin.unsafe(`create database ${scratch}`)
    const url = new URL(process.env.DATABASE_URL)
    url.pathname = `/${scratch}`
    execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
    process.env.DATABASE_URL = url.toString()
    sql = connect({ max: 2 })
    const typed = { source: 'typed' as const, photo_id: null, product_id: null }
    for (const [key, name, garment_type] of [
      ['coat', 'Camel coat', 'coat'],
      ['crew', 'Pine crew', 'knitwear'],
      ['oxford', 'Ecru oxford', 'shirt'],
      ['chinos', 'Putty chinos', 'trousers'],
      ['boots', 'Brown Chelseas', 'boots'],
      ['sneakers', 'White sneakers', 'sneakers'],
      ['tee', 'Navy tee', 'tee'],
    ] as const) {
      ids[key] = await createPiece(
        { name, garment_type, colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, worn_for: 'everyday', brand: null, size: null, notes: null, slot_id: null },
        typed,
      )
    }
  })

  after(async () => {
    await sql?.end()
    await db().end()
    await admin.unsafe(`drop database if exists ${scratch} with (force)`)
    await admin.end()
  })

  const meta = { model: 'claude-opus-5-5', served_by: 'claude-opus-5-5', input_tokens: 6_000, output_tokens: 800, generated_at: '' }
  const answer = (made: RemakeDraft) => ({
    draft: async (): Promise<RemakeResult> => ({ draft: made, meta, usd: 0.04 }),
  })
  const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
    const { info, warn } = console
    console.info = () => {}
    console.warn = () => {}
    try {
      return await run()
    } finally {
      console.info = info
      console.warn = warn
    }
  }

  let lookId = 0
  let dayId = 0

  test('a saved look he wore today, and the day’s outfit that shows it', async () => {
    await saveGuide(guideFixture, meta)
    await saveSet(
      {
        looks: [
          {
            title: 'Camel over pine',
            occasion: 'office',
            weather: 'cool',
            piece_ids: [ids.coat!, ids.crew!, ids.oxford!, ids.chinos!, ids.boots!],
            why: 'Why.',
            styling: null,
            better_with: null,
          },
        ],
        proposed: 1,
        meta,
        usd: 0.2,
      },
      { note: null, pieces: 7, date: '2026-11-05', weather: 'cool' },
      sql,
    )
    lookId = (await readLooks(sql)).fresh[0]!.id
    await actOnLook({ action: 'wore', look_id: lookId }, sql)

    const [day] = await sql<{ id: number }[]>`
      insert into day_outfits (for_date) values (${dressDate()}) returning id::int as id
    `
    dayId = day!.id
    await saveDay(
      dayId,
      {
        options: [
          {
            title: 'Renamed',
            occasion: 'office',
            weather: 'cool',
            piece_ids: [ids.coat!, ids.crew!, ids.oxford!, ids.chinos!, ids.boots!],
            why: 'Why.',
            styling: null,
            today: 'A cold morning: the coat.',
          },
        ],
        gym: null,
        proposed: 1,
        meta,
        usd: 0.08,
      },
      7,
      sql,
    )
    assert.equal((await readDay(dressDate(), sql))?.options[0]?.look.id, lookId, 'the saved look is the day’s option')
  })

  test('the prompt marks each piece and offers only the rest of his wardrobe, with the day', async () => {
    const [look] = await getLooks([lookId], sql)
    const input: RemakeInput = {
      profile: profileFixture,
      guide: guideFixture,
      pieces: await listPieces(sql),
      history: { saved: [], dismissed: [], worn: new Map() },
      look: look!,
      ask: { look_id: lookId, swap: [ids.boots!], remove: [ids.coat!], note: 'lighter shoes' },
      day: { id: dayId, date: '2026-11-06', forecast: null, note: null, today: 'A cold morning: the coat.' },
    }
    const content = String(buildRemakeMessages(input)[0]!.content)
    const body = JSON.parse(content.split('\n\n')[0]!)
    assert.deepEqual(
      body.look.pieces.map((p: { name: string; he_says: string }) => [p.name, p.he_says]),
      [
        ['Camel coat', 'remove'],
        ['Pine crew', 'keep'],
        ['Ecru oxford', 'keep'],
        ['Putty chinos', 'keep'],
        ['Brown Chelseas', 'swap'],
      ],
    )
    assert.deepEqual(body.pieces_to_choose_from.map((p: { name: string }) => p.name).sort(), ['Navy tee', 'White sneakers'])
    assert.equal(body.look.today, 'A cold morning: the coat.')
    assert.equal(body.day.weekday, 'Friday')
    assert.equal(body.usual_weather, undefined)
    assert.match(content, /Remake the look: 1 piece to swap, 1 to remove\. He says: "lighter shoes"\.$/)
  })

  test('one remake of a look at a time, shown on the look while it is made', async () => {
    const started = await startRemake({ look_id: lookId, swap: [ids.boots!], remove: [ids.coat!], note: '  lighter   shoes ' }, sql)
    assert.equal(started.ok, true)
    assert.deepEqual(await startRemake({ look_id: lookId, swap: [ids.boots!], remove: [], note: null }, sql), {
      ok: false,
      message: 'This look is already being remade.',
    })
    const [look] = await getLooks([lookId], sql)
    assert.deepEqual(look?.remaking, { swap: [ids.boots], remove: [ids.coat] })
    const [row] = await sql<{ note: string; day_id: number }[]>`select note, day_id::int as day_id from look_remakes where look_id = ${lookId}`
    assert.deepEqual(row, { note: 'lighter shoes', day_id: dayId })

    const done = await quietly(() =>
      runRemake(
        started.ok ? started.id : 0,
        sql,
        answer(draft([ids.sneakers!, ids.chinos!, ids.oxford!, ids.crew!], { today: 'Dry and mild by noon: the crew alone.' })),
      ),
    )
    assert.equal(done.ok, true)
    assert.equal(done.ok && done.onShow, true, 'the day’s option on show, so its picture is drawn')
  })

  test('the remake takes the look’s place: saved, worn today, on the day, and the old look kept as replaced', async () => {
    const page = await readLooks(sql)
    const [remade] = page.fresh
    assert.equal(page.fresh.length, 1, 'in the same set and place')
    assert.notEqual(remade?.id, lookId)
    assert.equal(remade?.title, 'Crew and white sneakers')
    assert.equal(remade?.status, 'saved')
    assert.deepEqual(remade?.pieces.map((p) => p.name), ['Pine crew', 'Ecru oxford', 'Putty chinos', 'White sneakers'])
    assert.equal(remade?.worn.length, 1, 'today’s wear moved to it')
    assert.equal(remade?.remaking, null)

    const [old] = await getLooks([lookId], sql)
    assert.equal(old?.status, 'replaced')
    assert.deepEqual(old?.worn, [], 'he is wearing the remade one today')
    assert.ok(!(await readHistory(sql)).saved.some((look) => look.title === 'Camel over pine'), 'the next set does not see it as saved')

    const day = await readDay(dressDate(), sql)
    assert.equal(day?.options[0]?.look.id, remade?.id)
    assert.equal(day?.options[0]?.today, 'Dry and mild by noon: the crew alone.')
    assert.equal(day?.remake_usd, 0.04)
    assert.equal(day?.usd, 0.08)

    const [row] = await sql<{ status: string; new_look_id: number; usd: number }[]>`
      select status, new_look_id::int as new_look_id, usd::float as usd from look_remakes where look_id = ${lookId}
    `
    assert.deepEqual(row, { status: 'ready', new_look_id: remade!.id, usd: 0.04 })
    lookId = remade!.id
  })

  test('a remake that does not hold together fails in words and leaves the look as it was', async () => {
    const started = await startRemake({ look_id: lookId, swap: [ids.crew!], remove: [], note: null }, sql)
    assert.ok(started.ok)
    const done = await quietly(() => runRemake(started.id, sql, answer(draft([ids.crew!, ids.oxford!, ids.chinos!, ids.sneakers!]))))
    assert.deepEqual(done, { ok: false, message: 'The remade look did not hold together. Try again.' })
    const [look] = await getLooks([lookId], sql)
    assert.equal(look?.status, 'saved')
    assert.equal(look?.remaking, null)
    assert.equal((await readDay(dressDate(), sql))?.remake_usd, 0.08, 'the failed call is counted too')
  })

  test('a remake into an outfit already made is that look, not a copy', async () => {
    await saveSet(
      {
        looks: [{ title: 'Navy tee day', occasion: 'weekend', weather: 'mild', piece_ids: [ids.tee!, ids.chinos!, ids.sneakers!], why: 'Why.', styling: null, better_with: null }],
        proposed: 1,
        meta,
        usd: 0.2,
      },
      { note: 'weekend', pieces: 7, date: '2026-11-05', weather: 'mild' },
      sql,
    )
    const made = (await readLooks(sql)).fresh[0]!
    const count = async () => (await sql<{ count: number }[]>`select count(*)::int as count from looks`)[0]!.count
    const before = await count()

    const started = await startRemake({ look_id: lookId, swap: [ids.crew!], remove: [ids.oxford!], note: null }, sql)
    assert.ok(started.ok)
    const done = await quietly(() => runRemake(started.id, sql, answer(draft([ids.sneakers!, ids.tee!, ids.chinos!]))))
    assert.equal(done.ok, true)
    assert.equal(await count(), before, 'no new look')
    const [reused] = await getLooks([made.id], sql)
    assert.equal(reused?.title, 'Navy tee day', 'with its own words')
    assert.equal(reused?.status, 'saved', 'saved, as the look it replaced was')
    assert.equal((await readDay(dressDate(), sql))?.options[0]?.look.id, made.id, 'on the day in its place')
    lookId = made.id
  })

  test('a removal that breaks the outfit is refused before any call', async () => {
    assert.deepEqual(await startRemake({ look_id: lookId, swap: [], remove: [ids.sneakers!], note: null }, sql), {
      ok: false,
      message: 'Without those it is not a whole outfit. Swap one instead of removing it.',
    })
  })
})
