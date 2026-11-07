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
  tidyGym,
  trainsOn,
  type DayDraft,
  type DayInput,
  type DayOption,
} from '../src/lib/day-outfit.ts'
import { actOnLook, lookKey, readLooks, saveSet } from '../src/lib/looks.ts'
import { createPiece, type Piece } from '../src/lib/pieces.ts'
import { saveGuide } from '../src/lib/style-guide.ts'
import { warmthLimit } from '../src/lib/warmth.ts'
import type { Forecast } from '../src/lib/weather.ts'

import { guideFixture, profileFixture } from './fixtures.ts'

/*
 * The outfit of the day: the rules its options are held to, the prompt, and
 * a day made, read and turned against a real Postgres in a scratch database
 * (never the one DATABASE_URL names). Opus and the forecast are never called;
 * the draft is a fixture.
 */

type Shelf = Pick<Piece, 'id' | 'name' | 'garment_type' | 'fabric' | 'warmth' | 'set_aside_at' | 'worn_for'>
const piece = (id: number, garment_type: Shelf['garment_type'], name: string, extra: Partial<Shelf> = {}): Shelf => ({
  id,
  name,
  garment_type,
  fabric: null,
  warmth: null,
  set_aside_at: null,
  worn_for: 'everyday',
  ...extra,
})
const shelf: Shelf[] = [
  piece(1, 'coat', 'Ink wool coat'),
  piece(2, 'knitwear', 'Pine merino crewneck'),
  piece(3, 'shirt', 'White oxford button-down'),
  piece(4, 'trousers', 'Putty chinos'),
  piece(5, 'jeans', 'Indigo jeans'),
  piece(6, 'boots', 'Brown chelsea boots'),
  piece(7, 'sneakers', 'White sneakers', { worn_for: 'both' }),
  piece(8, 'tank', 'Pine training tank', { worn_for: 'gym' }),
  piece(9, 'shorts', 'Black training shorts', { worn_for: 'gym' }),
  piece(10, 'tee', 'Cream tee'),
  piece(11, 'overshirt', 'Olive cotton overshirt'),
  piece(12, 'sweatshirt', 'Grey hoodie', { worn_for: 'both' }),
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

  test('a gym fit is never one of the day’s options', () => {
    assert.deepEqual(tidyDay([option([8, 9, 7], { occasion: 'gym' })], shelf, { dismissed: [] }, []), [])
  })

  test('the gym fit is gym kit only; it may repeat one he wore this week, never one he dismissed', () => {
    const gym = option([7, 9, 8], { occasion: 'weekend', title: ' Tank and shorts ' })
    assert.deepEqual(tidyGym(gym, shelf, { dismissed: [] }), {
      ...gym,
      occasion: 'gym',
      title: 'Tank and shorts',
      piece_ids: [8, 9, 7],
      better_with: null,
    })
    assert.equal(tidyGym(option([8, 4, 7]), shelf, { dismissed: [] }), null, 'everyday trousers are not gym kit')
    assert.equal(tidyGym(gym, shelf, { dismissed: [{ title: 'x', piece_ids: [7, 8, 9], reason: 'colours' }] }), null)
  })

  test('on a warm day an option over the warmth limit is dropped', () => {
    const options = [
      option([10, 11, 3, 4, 7]), // three layers
      option([2, 3, 4, 6]), // a wool knit
      option([10, 11, 4, 7]), // a tee and an overshirt
      option([3, 5, 7]), // a shirt
    ]
    assert.deepEqual(
      tidyDay(options, shelf, { dismissed: [] }, [], warmthLimit(23)).map((o) => o.piece_ids),
      [[11, 10, 4, 7], [3, 5, 7]],
    )
    assert.equal(tidyDay(options, shelf, { dismissed: [] }, [], warmthLimit(16)).length, 3, 'a mild day takes three layers and one warm piece')
    assert.equal(tidyDay(options, shelf, { dismissed: [] }, [], warmthLimit(10)).length, 3, 'a cold day has no limit')
  })

  test('the gym fit keeps to the warmth limit too', () => {
    const hoodie = option([12, 8, 9, 7], { occasion: 'gym' })
    assert.equal(tidyGym(hoodie, shelf, { dismissed: [] }, warmthLimit(24)), null)
    assert.ok(tidyGym(hoodie, shelf, { dismissed: [] }, warmthLimit(12)))
  })

  test('a look is the same outfit as another with the same pieces in any order, gym or not', () => {
    assert.equal(lookKey({ occasion: 'office', piece_ids: [6, 4, 2] }), lookKey({ occasion: 'weekend', piece_ids: [2, 4, 6] }))
    assert.notEqual(lookKey({ occasion: 'office', piece_ids: [7, 8, 9] }), lookKey({ occasion: 'gym', piece_ids: [7, 8, 9] }))
    assert.notEqual(lookKey({ occasion: 'office', piece_ids: [2, 4, 6] }), lookKey({ occasion: 'office', piece_ids: [2, 4, 6, 1] }))
  })

  test('his week says which days he trains', () => {
    const profile = { life: { gym_days: ['monday' as const, 'friday' as const] } }
    assert.equal(trainsOn(profile, '2026-11-06'), true, 'a Friday')
    assert.equal(trainsOn(profile, '2026-11-07'), false, 'a Saturday')
    assert.equal(trainsOn({ life: { gym: 4 } }, '2026-11-06'), false, 'a count alone names no day')
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
      trains_today: false,
      dressing_for: 'tomorrow, laid out the evening before',
      season_in_new_zealand: 'late spring',
    })
    assert.equal(body.forecast_wellington.in_short, '9° to 15°, feels like 5°. Southerly 40 km/h, gusts to 75. A chance of a shower.')
    assert.equal(body.usual_weather, undefined)
    assert.deepEqual(body.warmth_limit, {
      read_from: 'feels like 13° at the warmest',
      most_layers: null,
      most_warm_pieces: null,
      garments_ruled_out: [],
    })
    assert.deepEqual(body.gym, { days_a_week: 0, days: null, kit_ready: false, kit_missing: ['a top', 'shorts or joggers', 'trainers'] })
  })

  test('on a gym day the prompt says he trains', () => {
    const profile = { ...profileFixture, life: { gym: 2, gym_days: ['friday' as const, 'sunday' as const] } }
    const body = JSON.parse(String(buildDayMessages(input({ profile }))[0]!.content).split('\n\n')[0]!)
    assert.equal(body.day.trains_today, true)
    assert.equal(body.gym.days_a_week, 2)
  })

  test('with no forecast it is dressed for the month, and his note leads the ask', () => {
    const [message] = buildDayMessages(input({ forecast: null, note: 'dinner out tonight', now: new Date('2026-11-05T20:00:00Z') }))
    const content = String(message!.content)
    const body = JSON.parse(content.split('\n\n')[0]!)
    assert.match(body.usual_weather, /^Wellington in November: usually 11 to 17 degrees/)
    assert.equal(body.forecast_wellington, undefined)
    assert.equal(body.warmth_limit.read_from, "the month's usual high, 17°")
    assert.equal(body.warmth_limit.most_layers, 3)
    assert.equal(body.day.dressing_for, 'today')
    assert.match(content, /He says this is on: "dinner out tonight"/)
  })
})

describe('a day made, read and turned', () => {
  const scratch = `wardrobe_day_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  const ids: number[] = []
  const kit: number[] = []

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
          { name, garment_type, colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, worn_for: 'everyday', brand: null, size: null, notes: null, slot_id: null },
          typed,
        ),
      )
    }
    for (const [name, garment_type, worn_for] of [
      ['Pine training tank', 'tank', 'gym'],
      ['Black gym shorts', 'shorts', 'gym'],
      ['White trainers', 'sneakers', 'both'],
    ] as const) {
      kit.push(
        await createPiece(
          { name, garment_type, colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, worn_for, brand: null, size: null, notes: null, slot_id: null },
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
  const drafted = (options: DayOption[], gym: DayOption | null = null) => ({
    draft: async (): Promise<DayDraft> => ({ options, gym, proposed: options.length, meta, usd: 0.076 }),
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
    assert.equal(day?.gym, null, 'no gym fit on a day he does not train')
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

  test('on a day he trains, the gym fit is kept apart from the options, and is not drawn without a tap', async () => {
    const [shirt, , chinos, boots] = ids as [number, number, number, number, number]
    const [tank, shorts, trainers] = kit as [number, number, number]
    const id = await making('2026-11-09')
    drawn.length = 0
    const info = console.info
    console.info = () => {}
    try {
      await runDay(
        id,
        sql,
        drafted(
          [option([shirt, chinos, boots], { title: 'Oxford and putty', today: 'Mild.' })],
          option([tank, shorts, trainers], { occasion: 'gym', title: 'Pine tank session', today: 'Cold walk there: the tank under your coat.' }),
        ),
      )
    } finally {
      console.info = info
    }
    const day = await readDay('2026-11-09', sql)
    assert.deepEqual(day?.options.map((o) => o.look.title), ['Oxford and putty'])
    assert.equal(day?.gym?.look.title, 'Pine tank session')
    assert.equal(day?.gym?.look.occasion, 'gym')
    assert.equal(day?.gym?.today, 'Cold walk there: the tank under your coat.')
    assert.deepEqual(day?.gym?.look.pieces.map((p) => p.name), ['Pine training tank', 'Black gym shorts', 'White trainers'])
    assert.deepEqual(drawn, [day!.options[0]!.look.id], 'only the outfit on show is drawn')
    // Another turns the day's options only.
    assert.equal(await showNext(id, sql), day!.options[0]!.look.id)
  })

  test('an option that is a look offered before is that look, picture and all; a dismissed one is not reused', async () => {
    const [shirt, crew, chinos, boots, tee] = ids as [number, number, number, number, number]
    const [tank, shorts, trainers] = kit as [number, number, number]
    const earlier = (await readDay('2026-11-09', sql))!
    const oxford = earlier.options[0]!.look
    const gymFit = earlier.gym!.look
    assert.equal(oxford.status, 'new', 'offered on another day, never saved')

    // A set from the Looks tab: a look that is drawn, and one he dismissed.
    const look = (title: string, piece_ids: number[]) =>
      ({ title, occasion: 'weekend', weather: 'mild', piece_ids, why: 'Why.', styling: null, better_with: null }) as const
    const setId = await saveSet(
      {
        looks: [look('Drawn twin', [crew, tee, chinos, boots]), look('Dismissed one', [crew, chinos, boots])],
        proposed: 2,
        meta,
        usd: 0.2,
      },
      { note: null, pieces: 8, date: '2026-11-09', weather: 'mild' },
      sql,
    )
    const inSet = await sql<{ id: number; title: string }[]>`select id::int as id, title from looks where set_id = ${setId}`
    const idOf = (title: string) => inSet.find((l) => l.title === title)!.id
    await sql`
      insert into look_images (look_id, outfit_key, pieces, pieces_key, provider, model, status, prompt)
      values (${idOf('Drawn twin')}, '', '[]'::jsonb, 'key', 'openai', 'gpt-image', 'ready', 'Draw it.')
    `
    // A newer copy with the same pieces, as sets made before they reused looks could leave.
    const [twin] = await sql<{ id: number }[]>`
      insert into looks (set_id, position, title, occasion, weather, why, piece_count)
      values (${setId}, 9, 'Undrawn twin', 'weekend', 'mild', 'Why.', 4) returning id::int as id
    `
    await sql`insert into look_pieces ${sql([crew, tee, chinos, boots].map((piece_id, position) => ({ look_id: twin!.id, piece_id, position })))}`
    await actOnLook({ action: 'dismiss', look_id: idOf('Dismissed one'), reason: 'not_me' }, sql)
    const countLooks = async () => (await sql<{ count: number }[]>`select count(*)::int as count from looks`)[0]!.count
    const looksBefore = await countLooks()

    const id = await making('2026-11-10')
    drawn.length = 0
    const info = console.info
    console.info = () => {}
    try {
      await runDay(
        id,
        sql,
        drafted(
          [
            option([boots, chinos, shirt], { title: 'Claude called it something else', today: 'Mild again.' }),
            option([tee, crew, chinos, boots], { occasion: 'weekend', title: 'Tee under the crew', today: 'Cool morning.' }),
            option([crew, chinos, boots], { title: 'Crew and putty', today: 'Dry all day.' }),
          ],
          option([trainers, tank, shorts], { occasion: 'gym', title: 'Same kit', today: 'A still evening.' }),
        ),
      )
    } finally {
      console.info = info
    }

    const day = (await readDay('2026-11-10', sql))!
    assert.equal(day.status, 'ready')
    assert.deepEqual(
      day.options.map((o) => [o.look.title, o.today]),
      [
        ['Oxford and putty', 'Mild again.'],
        ['Drawn twin', 'Cool morning.'],
        ['Crew and putty', 'Dry all day.'],
      ],
    )
    assert.equal(day.options[0]!.look.id, oxford.id, 'the look offered on another day, not a copy')
    assert.equal(day.options[1]!.look.id, idOf('Drawn twin'), 'of two the same, the one already drawn')
    assert.equal(day.options[1]!.image?.status, 'ready', 'its picture comes with it')
    assert.notEqual(day.options[2]!.look.id, idOf('Dismissed one'), 'a dismissed look is never brought back')
    assert.equal(day.gym?.look.id, gymFit.id, 'the gym fit offered before')
    assert.equal(day.gym?.today, 'A still evening.', 'with this day’s line')
    assert.equal((await countLooks()) - looksBefore, 1, 'only the one with no match is a new look')
    assert.deepEqual(drawn, [oxford.id])
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
