import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import {
  buildDayMessages,
  readDay,
  runDay,
  showNext,
  startDay,
  tidyDay,
  type DayDraft,
  type DayInput,
  type DayOption,
} from '../src/lib/day-outfit.ts'
import { actOnLook, readLooks, saveSet } from '../src/lib/looks.ts'
import { createPiece, type Piece } from '../src/lib/pieces.ts'
import { saveGuide } from '../src/lib/style-guide.ts'
import type { Forecast } from '../src/lib/weather.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

/*
 * The outfit of the day: the rules its options are held to, the prompt, and
 * a day made, read and turned against a real Postgres in a scratch database
 * (never the one DATABASE_URL names). Opus and the forecast are never called;
 * the draft is a fixture.
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
]

const option = (piece_ids: number[], extra: Partial<DayOption> = {}): DayOption => ({
  title: ' Pine and putty ',
  occasion: 'office',
  weather: 'cool southerly',
  piece_ids,
  why: 'Because.',
  styling: null,
  today: 'Showers from 3pm: the coat.',
  ...extra,
})

const forecast: Forecast = {
  date: '2026-11-06',
  read_at: '2026-11-05T18:00:00.000Z',
  high: 15,
  low: 9,
  feels_high: 13,
  feels_low: 5,
  rain_chance: 80,
  rain_mm: 4.2,
  wind_kmh: 40,
  gust_kmh: 75,
  wind_from: 'southerly',
  sky: 'showers',
  uv: 4,
  hours: [],
}

describe('the pure parts', () => {
  test('a look he saved may come back; one he dismissed or wore this week may not; at most three are kept', () => {
    const kept = tidyDay(
      [
        option([1, 3, 4, 6]),
        option([3, 5, 7]),
        option([2, 4, 6]),
        option([2, 5, 6]),
        option([1, 2, 3, 4, 6]),
        option([1, 2, 5, 7]),
      ],
      shelf,
      { dismissed: [{ title: 'x', piece_ids: [5, 3, 7], reason: 'colours' }] },
      [{ piece_ids: [6, 4, 2] }],
    )
    assert.deepEqual(
      kept.map((o) => o.piece_ids),
      [[1, 3, 4, 6], [2, 5, 6], [1, 2, 3, 4, 6]],
    )
    assert.equal(kept[0]?.title, 'Pine and putty')
    assert.equal(kept[0]?.today, 'Showers from 3pm: the coat.', 'the day sentence survives the tidy')
  })

  test('an option that is not a whole outfit is dropped', () => {
    assert.deepEqual(tidyDay([option([3, 4]), option([3, 4, 5, 6])], shelf, { dismissed: [] }, []), [])
  })

  const input = (extra: Partial<DayInput> = {}): DayInput => ({
    profile: profileFixture,
    guide: guideFixture,
    pieces: [],
    history: { saved: [], dismissed: [], worn: new Map() },
    wornThisWeek: [],
    date: '2026-11-06',
    forecast,
    note: null,
    now: new Date('2026-11-05T07:00:00Z'), // 8pm in Wellington, the evening before
    ...extra,
  })

  test('the prompt carries the day, the season and the forecast', () => {
    const body = JSON.parse(String(buildDayMessages(input())[0]!.content).split('\n\n')[0]!)
    assert.deepEqual(body.day, {
      date: '2026-11-06',
      weekday: 'Friday',
      dressing_for: 'tomorrow, laid out the evening before',
      season_in_new_zealand: 'late spring',
    })
    assert.equal(body.forecast_wellington.in_short, '9° to 15°, feels like 5°. Southerly 40 km/h, gusts to 75. A chance of a shower.')
    assert.equal(body.usual_weather, undefined)
  })

  test('with no forecast it is dressed for the month, and his note leads the ask', () => {
    const [message] = buildDayMessages(input({ forecast: null, note: 'dinner out tonight', now: new Date('2026-11-05T20:00:00Z') }))
    const content = String(message!.content)
    const body = JSON.parse(content.split('\n\n')[0]!)
    assert.match(body.usual_weather, /^Wellington in November: usually 11 to 17 degrees/)
    assert.equal(body.forecast_wellington, undefined)
    assert.equal(body.day.dressing_for, 'today')
    assert.match(content, /He says this is on: "dinner out tonight"/)
  })
})

describe('a day made, read and turned', () => {
  const scratch = `wardrobe_day_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  const ids: number[] = []

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the outfit of the day test')
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
      ['Navy tee', 'tee'],
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

  const meta = { model: 'claude-opus-5-5', served_by: 'claude-opus-5-5', input_tokens: 9_000, output_tokens: 2_000, generated_at: '' }
  const drawn: number[] = []
  /** Opus's answer as a fixture, and a picture that is only noted, never drawn. */
  const drafted = (options: DayOption[]) => ({
    draft: async (): Promise<DayDraft> => ({ options, proposed: options.length, meta, usd: 0.076 }),
    draw: async (lookId: number) => {
      drawn.push(lookId)
    },
  })

  async function making(date = '2026-11-06'): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      insert into day_outfits (for_date, forecast) values (${date}, ${sql.json(forecast)}) returning id::int as id
    `
    return row!.id
  }

  test('without a style guide it is not started, and a run fails in words', async () => {
    const started = await startDay({}, sql)
    assert.equal(started.ok, false)
    const id = await making()
    const warn = console.warn
    console.warn = () => {}
    try {
      await runDay(id, sql, drafted([]))
    } finally {
      console.warn = warn
    }
    const day = await readDay('2026-11-06', sql)
    assert.equal(day?.status, 'failed')
    assert.equal(day?.error, 'Draft your style guide first.')
  })

  test('the options are saved best first; one that matches a saved look is that look', async () => {
    await saveGuide(guideFixture, meta)
    const [shirt, crew, chinos, boots, tee] = ids as [number, number, number, number, number]
    // A look he saved from the Looks tab, and that tab's newest set.
    await saveSet(
      {
        looks: [{ title: 'Saved one', occasion: 'office', weather: 'mild', piece_ids: [crew, shirt, chinos, boots], why: 'Saved why.', styling: null, better_with: null }],
        proposed: 1,
        meta,
        usd: 0.2,
      },
      { note: null, pieces: 5, date: '2026-11-04', weather: 'mild' },
      sql,
    )
    const before = await readLooks(sql)
    const savedId = before.fresh[0]!.id
    await actOnLook({ action: 'save', look_id: savedId }, sql)

    const id = await making()
    const info = console.info
    console.info = () => {}
    try {
      await runDay(
        id,
        sql,
        drafted([
          option([shirt, chinos, boots, crew], { title: 'Claude renamed it', today: 'Cool and showery: the crew over the oxford.' }),
          option([tee, chinos, boots], { title: 'Tee and putty', today: 'Warm by 2pm.' }),
        ]),
      )
    } finally {
      console.info = info
    }

    const day = await readDay('2026-11-06', sql)
    assert.equal(day?.status, 'ready')
    assert.equal(day?.usd, 0.076)
    assert.deepEqual(
      day?.options.map((o) => [o.look.title, o.today]),
      [
        ['Saved one', 'Cool and showery: the crew over the oxford.'],
        ['Tee and putty', 'Warm by 2pm.'],
      ],
    )
    assert.equal(day?.options[0]?.look.id, savedId, 'the saved look itself, not a copy')
    assert.deepEqual(drawn, [savedId], 'the option on show, and only it, is drawn')
    assert.equal(day?.options[0]?.image, null, 'no picture until one is drawn')
    assert.deepEqual(day?.options[1]?.look.pieces.map((p) => p.name), ['Navy tee', 'Putty chinos', 'Brown Chelseas'])

    // The Looks tab is not disturbed: its newest set is still the one he made there.
    const page = await readLooks(sql)
    assert.equal(page.latest?.id, before.latest?.id)
    assert.deepEqual(page.total, { sets: 1, usd: 0.2 })
    assert.deepEqual(page.saved.map((l) => l.title).concat(page.fresh.map((l) => l.title)), ['Saved one'])

    // Wearing the day's new option saves it, and it joins the saved looks.
    await actOnLook({ action: 'wore', look_id: day!.options[1]!.look.id }, sql)
    assert.ok((await readLooks(sql)).saved.some((l) => l.title === 'Tee and putty'))
  })

  test('another turns to the next option, round to the first', async () => {
    const day = (await readDay('2026-11-06', sql))!
    assert.equal(day.shown, 0)
    assert.equal(await showNext(day.id, sql), day.options[1]!.look.id, 'it says which look is now on show')
    assert.equal((await readDay('2026-11-06', sql))?.shown, 1)
    assert.equal(await showNext(day.id, sql), day.options[0]!.look.id)
    assert.equal((await readDay('2026-11-06', sql))?.shown, 0)
  })

  test('a day already dressed is left alone, unless he asks again; one in the making blocks another', async () => {
    const now = new Date('2026-11-05T20:00:00Z') // 9am on the 6th in Wellington
    const existing = (await readDay('2026-11-06', sql))!
    assert.deepEqual(await startDay({ now }, sql), { ok: true, id: existing.id })

    // Asking again reads the forecast; this test never touches the network.
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch
    const warn = console.warn
    console.warn = () => {}
    try {
      const again = await startDay({ now, again: true, note: '  dinner   out ' }, sql)
      assert.equal(again.ok, true)
      const fresh = await readDay('2026-11-06', sql)
      assert.equal(fresh?.status, 'making')
      assert.equal(fresh?.note, 'dinner out')
      assert.equal(fresh?.forecast, null, 'no forecast: dressed for the month')
      const blocked = await startDay({ now, again: true }, sql)
      assert.equal(blocked.ok, false)
    } finally {
      globalThis.fetch = realFetch
      console.warn = warn
    }
  })

  test('a run whose options all fail the checks is a failure, not an empty day', async () => {
    const day = (await readDay('2026-11-06', sql))!
    const warn = console.warn
    console.warn = () => {}
    try {
      await runDay(day.id, sql, drafted([]))
    } finally {
      console.warn = warn
    }
    const failed = await readDay('2026-11-06', sql)
    assert.equal(failed?.status, 'failed')
    assert.match(failed?.error ?? '', /held up/)
  })
})
