import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { lookWearLine, wearLine } from '../src/lib/format.ts'
import { actOnLook, readLooks, saveSet } from '../src/lib/looks.ts'
import { createPiece } from '../src/lib/pieces.ts'
import { byPassedOver, readWear, rotateOut, wearOf } from '../src/lib/wear.ts'

/*
 * What gets worn and what only gets offered: the lines, the order, the rule
 * for what to rotate out, then the counts against a real Postgres in a
 * scratch database (never the one DATABASE_URL names).
 */

describe('the lines and the rules', () => {
  test('a look says how often it was offered, how much of that on Today, and when it was last worn', () => {
    assert.equal(wearLine({ offered: 7, on_today: 3, worn: 1, last_worn: '2026-11-02' }), 'Offered 7 times, 3 on Today. Worn once, on 2 November.')
    assert.equal(wearLine({ offered: 2, on_today: 2, worn: 0, last_worn: null }), 'Offered twice, all on Today. Never worn.')
    assert.equal(wearLine({ offered: 1, on_today: 1, worn: 3, last_worn: '2026-11-06' }), 'Offered once, on Today. Worn 3 times, last on 6 November.')
    assert.equal(wearLine({ offered: 9, looks: 4, worn: 2, last_worn: '2026-11-05' }), 'Offered 9 times, in 4 looks. Worn twice, last on 5 November.')
    assert.equal(wearLine({ offered: 0, worn: 0, last_worn: null }), 'Never in a look yet.')
  })

  test('a look card says nothing until there is something to say', () => {
    assert.equal(lookWearLine({ offered: 1, on_today: 0, worn: [] }), null, 'just made')
    assert.equal(lookWearLine({ offered: 2, on_today: 0, worn: [] }), 'Offered twice. Never worn.')
    assert.equal(lookWearLine({ offered: 1, on_today: 0, worn: ['2026-11-07'] }), 'Offered once. Worn once, on 7 November.')
  })

  test('what he passes over most comes first, then the least worn, then the longest since', () => {
    const rows = [
      { id: 1, offered: 3, worn: 3, last_worn: '2026-11-06' },
      { id: 2, offered: 8, worn: 1, last_worn: '2026-11-01' },
      { id: 3, offered: 5, worn: 0, last_worn: null },
      { id: 4, offered: 2, worn: 0, last_worn: null },
      { id: 5, offered: 3, worn: 1, last_worn: '2026-11-02' },
      { id: 6, offered: 3, worn: 1, last_worn: '2026-11-05' },
    ]
    assert.deepEqual(rows.toSorted(byPassedOver).map((row) => row.id), [2, 3, 4, 5, 6, 1])
  })

  test('a piece is one to rotate out when worn on at most one offer in four, or long owned and never in a look', () => {
    const now = new Date('2026-11-30T12:00:00+13:00')
    const old = new Date('2026-10-01T12:00:00+13:00')
    const piece = (offered: number, worn: number) => ({ offered, looks: 1, worn, last_worn: worn ? '2026-11-02' : null })
    assert.equal(rotateOut(piece(4, 1), old, '2026-11-04', now), true)
    assert.equal(rotateOut(piece(3, 0), old, '2026-11-04', now), true)
    assert.equal(rotateOut(piece(7, 2), old, '2026-11-04', now), false, 'worn on more than one in four')
    assert.equal(rotateOut(piece(2, 0), old, '2026-11-04', now), false, 'too few offers to tell')
    assert.equal(rotateOut(piece(0, 0), old, '2026-11-04', now), true, 'never in a look, three weeks after looks began')
    assert.equal(rotateOut(piece(0, 0), old, '2026-11-20', now), false, 'looks began ten days ago')
    assert.equal(rotateOut(piece(0, 0), new Date('2026-11-25T12:00:00+13:00'), '2026-11-04', now), false, 'bought five days ago')
    assert.equal(rotateOut(piece(0, 0), old, null, now), false, 'no looks yet')
  })
})

describe('the counts', () => {
  const scratch = `wardrobe_wear_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  const ids: number[] = []

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the wear test')
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
      ['Rust overshirt', 'overshirt'],
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
    looks: lookIds.map((piece_ids, index) => ({
      title: `Look ${index + 1}`,
      occasion: 'office' as const,
      weather: 'mild',
      piece_ids,
      why: 'Because.',
      styling: null,
      better_with: null,
    })),
    proposed: lookIds.length,
    meta: { model: 'claude-opus-5-5', served_by: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, generated_at: '' },
    usd: 0.1,
  })

  /** A day's outfit offering these looks, as day-outfit.ts records one. */
  async function offerOnDay(date: string, lookIds: number[]) {
    const [set] = await sql<{ id: number }[]>`
      insert into look_sets (model, kind) values ('claude-opus-5-5', 'day') returning id::int as id
    `
    await sql`insert into day_outfits (for_date, status, set_id) values (${date}, 'ready', ${set!.id})`
    await sql`insert into look_set_looks ${sql(lookIds.map((look_id, position) => ({ set_id: set!.id, position, look_id })))}`
  }

  test('an offer is a set or a day, a day counts once, and pieces count through their looks', async () => {
    const [shirt, crew, chinos, boots] = ids as [number, number, number, number, number]
    assert.equal((await readWear()).since, null, 'nothing offered yet')

    await saveSet(draft([[shirt, chinos, boots], [crew, shirt, chinos, boots]]), { note: null, pieces: 5, date: '2026-11-04', weather: 'mild' })
    const [plain, layered] = (await readLooks()).fresh.map((look) => look.id) as [number, number]
    await saveSet(draft([[boots, chinos, shirt]]), { note: null, pieces: 5, date: '2026-11-05', weather: 'mild' })
    // Asked again on the same day: two day sets, one day.
    await offerOnDay('2026-11-06', [plain])
    await offerOnDay('2026-11-06', [plain, layered])
    await offerOnDay('2026-11-07', [plain])
    await actOnLook({ action: 'wore', look_id: layered })

    const page = await readWear()
    assert.equal(page.days_worn, 1)
    assert.ok(page.since, 'counted from the first offer')
    assert.deepEqual(
      page.saved.map((look) => [look.title, look.offered, look.on_today, look.worn.length]),
      [['Look 2', 2, 1, 1]],
      'wearing a look saves it',
    )
    assert.deepEqual(
      page.offered.map((look) => [look.id, look.offered, look.on_today]),
      [[plain, 4, 2]],
      'two sets and two days, not three day sets',
    )

    assert.deepEqual(await wearOf(shirt), { offered: 4, looks: 2, worn: 1, last_worn: page.saved[0]!.worn[0] })
    assert.deepEqual(await wearOf(crew), { offered: 2, looks: 1, worn: 1, last_worn: page.saved[0]!.worn[0] })
    assert.deepEqual(page.never.map((piece) => piece.name), ['Rust overshirt'])
    assert.deepEqual(
      page.rotate.map((piece) => piece.name),
      ['Ecru oxford', 'Putty chinos', 'Brown Chelseas'],
      'offered four times, worn once: one in four',
    )
    assert.deepEqual(page.pieces.map((piece) => piece.name), ['Pine crew'], 'worn on one of two offers stays')
  })

  test('a dismissed look leaves the lists, and its wears still count for its pieces', async () => {
    const [, crew] = ids as [number, number]
    const layered = (await readWear()).saved[0]!
    await actOnLook({ action: 'dismiss', look_id: layered.id, reason: 'not_me' })
    const page = await readWear()
    assert.equal(page.saved.length, 0)
    assert.ok(page.offered.every((look) => look.id !== layered.id))
    assert.equal((await wearOf(crew)).worn, 1)
  })
})
