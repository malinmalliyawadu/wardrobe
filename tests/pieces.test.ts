import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import sharp from 'sharp'

import { setSlotStatus } from '../src/lib/blueprint.ts'
import { connect, db, type Sql } from '../src/lib/db.ts'
import { recordAction } from '../src/lib/feed.ts'
import { attachPhoto, buildReadRequest, clearOrphans, storePiecePhoto, valuesFromRead, type PieceRead } from '../src/lib/piece-photos.ts'
import {
  asPiece,
  createPiece,
  deletePiece,
  fillableSlots,
  getPiece,
  listPieces,
  parseOrigin,
  parsePieceForm,
  PieceError,
  restorePiece,
  setAside,
  shelve,
  snapToGuide,
  updatePiece,
  type PieceValues,
} from '../src/lib/pieces.ts'
import { files } from '../src/lib/storage.ts'

import { guideFixture } from './fixtures.ts'

/*
 * The wardrobe: the pure parts, then pieces and slots together against a real
 * Postgres in a scratch database (never the one DATABASE_URL names) and a
 * throwaway PHOTOS_DIR. Claude is never called; its read is a fixture.
 */

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const values = (overrides: Partial<PieceValues> = {}): PieceValues => ({
  name: 'Oxblood merino crew',
  garment_type: 'knitwear',
  colour_hex: '#7a2e1f',
  colour_name: 'oxblood',
  fabric: 'merino',
  fit: 'slim',
  warmth: 'mid',
  worn_for: 'everyday',
  brand: null,
  size: 'S',
  notes: null,
  slot_id: null,
  ...overrides,
})

describe('the pure parts', () => {
  test('a read colour snaps to the palette only when it is close enough to be that colour', () => {
    // A little lighter than the guide's oxblood, as a photo in daylight reads it.
    assert.deepEqual(snapToGuide('#83352a', guideFixture), { hex: '#7a2e1f', name: 'oxblood', inPalette: true })
    // Cobalt is no colour of his.
    assert.deepEqual(snapToGuide('#1f4fd1', guideFixture), { hex: '#1f4fd1', name: null, inPalette: false })
    assert.deepEqual(snapToGuide('#ABC', null), { hex: '#aabbcc', name: null, inPalette: false })
  })

  test('the form parses, blanks are nulls, and a bad colour or garment says so in words', () => {
    const ok = parsePieceForm(form({ name: ' Pine overshirt ', garment_type: 'overshirt', colour_hex: '#2F4A3A', warmth: 'warm', slot_id: '7' }))
    assert.ok(ok.ok)
    assert.equal(ok.data.name, 'Pine overshirt')
    assert.equal(ok.data.colour_hex, '#2f4a3a')
    assert.equal(ok.data.fabric, null)
    assert.equal(ok.data.slot_id, 7)
    assert.equal(ok.data.worn_for, 'everyday', 'worn every day unless he says otherwise')
    const gym = parsePieceForm(form({ name: 'Pine tank', garment_type: 'tank', worn_for: 'gym' }))
    assert.ok(gym.ok)
    assert.equal(gym.data.worn_for, 'gym')

    const bad = parsePieceForm(form({ name: '', garment_type: 'cape', colour_hex: 'teal' }))
    assert.ok(!bad.ok)
    assert.equal(bad.errors.name, 'Fill this in')
    assert.equal(bad.errors.garment_type, 'Choose what kind of piece it is')
    assert.equal(bad.errors.colour_hex, 'Pick a colour')
    const notAUse = parsePieceForm(form({ name: 'Tank', garment_type: 'tank', worn_for: 'yoga' }))
    assert.ok(!notAUse.ok)
    assert.equal(notAUse.errors.worn_for, 'Choose what you wear it for')
  })

  test('a new piece must say where it came from, with the id that goes with it', () => {
    assert.deepEqual(parseOrigin(form({ source: 'photo', photo_id: '4' })), { source: 'photo', photo_id: 4, product_id: null })
    assert.equal(parseOrigin(form({ source: 'photo' })), null)
    assert.equal(parseOrigin(form({ source: 'link' })), null)
    assert.equal(parseOrigin(form({ source: 'slot' })), null, 'slot pieces are made by the app, never posted')
    assert.deepEqual(parseOrigin(form({ source: 'typed' })), { source: 'typed', photo_id: null, product_id: null })
  })

  test('pieces are shelved in the page order and empty shelves are left out', () => {
    const shelves = shelve(
      (['boots', 'tee', 'jeans', 'shirt'] as const).map((garment_type) => ({ garment_type, worn_for: 'everyday' as const })),
    )
    assert.deepEqual(
      shelves.map((shelf) => [shelf.title, shelf.pieces.length]),
      [['Tops', 2], ['Trousers', 1], ['Shoes', 1]],
    )
  })

  test('gym-only kit is a shelf of its own, last and in shelf order; kit worn for both stays with its kind', () => {
    const shelves = shelve([
      { garment_type: 'sneakers', worn_for: 'gym' },
      { garment_type: 'tank', worn_for: 'gym' },
      { garment_type: 'sneakers', worn_for: 'both' },
      { garment_type: 'tee', worn_for: 'everyday' },
    ])
    assert.deepEqual(
      shelves.map((shelf) => [shelf.title, shelf.pieces.map((piece) => piece.garment_type)]),
      [['Tops', ['tee']], ['Shoes', ['sneakers']], ['Gym kit', ['tank', 'sneakers']]],
    )
  })

  test('sport kit from a shop becomes the garment it is, worn for the gym', () => {
    assert.deepEqual(asPiece('Metal Vent Tech Tank', 'activewear'), { garment_type: 'tank', worn_for: 'gym' })
    assert.deepEqual(asPiece('Pace Breaker Lined Short 7"', 'activewear'), { garment_type: 'shorts', worn_for: 'gym' })
    assert.deepEqual(asPiece('Brooks Adrenaline GTS 24 Trainer', 'activewear'), { garment_type: 'sneakers', worn_for: 'gym' })
    assert.deepEqual(asPiece('ABC Pant', 'activewear'), { garment_type: 'trousers', worn_for: 'gym' })
    assert.deepEqual(asPiece('Metal Vent Tech', 'activewear'), { garment_type: 'activewear', worn_for: 'gym' }, 'no garment in the name: he says')
    assert.deepEqual(asPiece('Lucas Chelsea Boot', 'boots'), { garment_type: 'boots', worn_for: 'everyday' })
  })

  test('the palette colour Claude names wins only when it is really in the guide', () => {
    const read: PieceRead = {
      is_garment: true,
      name: 'pine brushed cotton overshirt',
      garment_type: 'overshirt',
      colour_words: 'Pine',
      palette_hex: '#2F4A3A',
      fabric: 'Brushed cotton',
      fit: 'regular',
      warmth: 'mid',
      brand: null,
      notes: 'Two chest pockets',
      gym_kit: false,
    }
    const fromClaude = valuesFromRead(read, '#555555', guideFixture)
    assert.equal(fromClaude.colour_hex, '#2f4a3a')
    assert.equal(fromClaude.name, 'Pine brushed cotton overshirt')
    assert.equal(fromClaude.colour_name, 'pine')
    assert.equal(fromClaude.fabric, 'brushed cotton')
    assert.equal(fromClaude.worn_for, 'everyday')
    assert.equal(valuesFromRead({ ...read, garment_type: 'tank', gym_kit: true }, null, guideFixture).worn_for, 'gym')
    // A hex that is not in the guide falls back to the local read, snapped.
    assert.equal(valuesFromRead({ ...read, palette_hex: '#123456' }, '#83352a', guideFixture).colour_hex, '#7a2e1f')
    // No read at all: the colour alone.
    assert.deepEqual(valuesFromRead(null, '#1f4fd1', guideFixture), { colour_hex: '#1f4fd1' })
  })

  test('the read request is Sonnet at low effort with the palette and the photo', () => {
    const request = buildReadRequest('AAAA', guideFixture)
    assert.equal(request.model, 'claude-sonnet-5-5')
    assert.equal(request.output_config.effort, 'low')
    const [image, text] = request.messages[0]!.content as { type: string; text?: string }[]
    assert.equal(image!.type, 'image')
    assert.match(text!.text ?? '', /"#7a2e1f"/)
    assert.match(buildReadRequest('AAAA', null).messages[0]!.content[1]!.type, /text/)
  })
})

describe('pieces and slots together', () => {
  const scratch = `wardrobe_pieces_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  let dir: string
  let position = 1

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the wardrobe test')
    admin = connect({ max: 1 })
    await admin.unsafe(`create database ${scratch}`)
    const url = new URL(process.env.DATABASE_URL)
    url.pathname = `/${scratch}`
    execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
    process.env.DATABASE_URL = url.toString()
    sql = connect({ max: 2 })
    dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-pieces-'))
    process.env.PHOTOS_DIR = dir
  })

  after(async () => {
    await sql?.end()
    await db().end()
    await admin.unsafe(`drop database if exists ${scratch} with (force)`)
    await admin.end()
    await rm(dir, { recursive: true, force: true })
  })

  async function slot(name: string, garment: string, status = 'wanted'): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      insert into blueprint_slots (position, name, why, priority, garment_type, colour_family, colours, fabrics, fit, status, source)
      values (${position++}, ${name}, 'Because.', 1, ${garment}, 'oxblood', ${['#7A2E1F']}, ${['merino']}, 'slim', ${status}, 'claude')
      returning id::int as id
    `
    return row!.id
  }

  const status = async (id: number) =>
    (await sql<{ status: string }[]>`select status from blueprint_slots where id = ${id}`)[0]?.status
  const piecesOf = async (slotId: number) =>
    sql<{ id: number; source: string }[]>`select id::int as id, source from wardrobe_pieces where slot_id = ${slotId} and set_aside_at is null`

  test('marking a slot owned brings a piece in; taking it back lets a placeholder go', async () => {
    const crew = await slot('Oxblood merino crewneck', 'knitwear')
    await setSlotStatus(crew, 'owned')
    const [made] = await piecesOf(crew)
    assert.ok(made)
    const piece = await getPiece(made.id)
    assert.equal(piece?.name, 'Oxblood merino crewneck')
    assert.equal(piece?.colour_hex, '#7a2e1f', 'the slot colour, lower case for the check')
    assert.equal(piece?.fabric, 'merino')
    assert.equal(piece?.source, 'slot')

    await setSlotStatus(crew, 'wanted')
    assert.equal((await piecesOf(crew)).length, 0)
    assert.equal(await getPiece(made.id), null, 'an untouched placeholder is deleted')

    // Once he has edited it, it is his: it stays, unlinked.
    await setSlotStatus(crew, 'owned')
    const [again] = await piecesOf(crew)
    await updatePiece(again!.id, values({ name: 'My oxblood crew', slot_id: crew }))
    await setSlotStatus(crew, 'candidate')
    const kept = await getPiece(again!.id)
    assert.equal(kept?.name, 'My oxblood crew')
    assert.equal(kept?.slot_id, null)
  })

  test('linking a piece owns the slot, moving it hands the old one back, and a filled slot cannot be taken twice', async () => {
    const first = await slot('Ecru oxford shirt', 'shirt')
    const second = await slot('Deep teal oxford shirt', 'shirt')
    const shirt = await createPiece(values({ name: 'Ecru oxford', garment_type: 'shirt', slot_id: first }), { source: 'typed', photo_id: null, product_id: null })
    assert.equal(await status(first), 'owned')
    assert.ok(!(await fillableSlots(null)).some((open) => open.id === first), 'a filled slot is not offered to another piece')
    assert.ok((await fillableSlots(shirt)).some((open) => open.id === first), 'but it stays on its own piece’s list')

    await assert.rejects(
      createPiece(values({ garment_type: 'shirt', slot_id: first }), { source: 'typed', photo_id: null, product_id: null }),
      PieceError,
    )

    await updatePiece(shirt, values({ name: 'Ecru oxford', garment_type: 'shirt', slot_id: second }))
    assert.equal(await status(first), 'wanted')
    assert.equal(await status(second), 'owned')
  })

  test('set aside hands the slot back or retires it; restore takes it again unless it has been filled', async () => {
    const boots = await slot('Dark brown suede Chelsea boot', 'boots')
    const piece = await createPiece(values({ name: 'Brown Chelseas', garment_type: 'boots', fit: null, slot_id: boots }), { source: 'typed', photo_id: null, product_id: null })
    await setAside(piece, 'retired')
    assert.equal(await status(boots), 'retired')
    assert.ok((await listPieces()).at(-1)?.set_aside_at, 'set-aside pieces sort last')

    await restorePiece(piece)
    assert.equal(await status(boots), 'owned', 'back in the wardrobe, back in its slot')

    await setAside(piece, 'wanted')
    assert.equal(await status(boots), 'wanted')
    const other = await createPiece(values({ name: 'New Chelseas', garment_type: 'boots', fit: null, slot_id: boots }), { source: 'typed', photo_id: null, product_id: null })
    await restorePiece(piece)
    assert.equal((await getPiece(piece))?.slot_id, null, 'the slot went to the new pair')
    assert.equal((await getPiece(other))?.slot_id, boots)

    await deletePiece(other)
    assert.equal(await status(boots), 'wanted')
  })

  test('"Bought it" makes the find a piece with its title, brand and size, in place of a placeholder', async () => {
    const [retailer] = await sql<{ id: number }[]>`
      insert into retailers (slug, name, platform, base_url, country, currency)
      values ('shop', 'Shop', 'shopify', 'https://shop.test', 'NZ', 'NZD') returning id::int as id
    `
    const [product] = await sql<{ id: number }[]>`
      insert into products (retailer_id, external_id, title, vendor, url, images, content_hash, garment_type)
      values (${retailer!.id}, '1', 'Lucas Chelsea Boot', 'Barkers', 'https://shop.test/p/1',
              ${sql.json([{ src: '//cdn.shopify.com/s/files/1/boot.jpg' }])}, 'h1', 'boots')
      returning id::int as id
    `
    const chelsea = await slot('Suede Chelsea boot', 'boots', 'candidate')
    await recordAction({ action: 'bought', product_id: product!.id, slot_id: chelsea }, sql)
    const [bought] = await piecesOf(chelsea)
    const piece = await getPiece(bought!.id)
    assert.equal(piece?.source, 'find')
    assert.equal(piece?.name, 'Lucas Chelsea Boot')
    assert.equal(piece?.brand, 'Barkers')
    assert.equal(piece?.retailer, 'Shop')
    assert.equal(piece?.image?.src, '//cdn.shopify.com/s/files/1/boot.jpg')
    assert.equal(await status(chelsea), 'owned')

    // Pressed twice, it is still one piece.
    await recordAction({ action: 'bought', product_id: product!.id, slot_id: chelsea }, sql)
    const [{ count } = { count: 0 }] = await sql<{ count: number }[]>`select count(*)::int as count from wardrobe_pieces where product_id = ${product!.id}`
    assert.equal(count, 1)

    // A slot already filled by a placeholder gives it up to the real thing.
    const belt = await slot('Espresso leather belt', 'belt', 'owned')
    await setSlotStatus(belt, 'owned')
    const [beltProduct] = await sql<{ id: number }[]>`
      insert into products (retailer_id, external_id, title, url, content_hash, garment_type)
      values (${retailer!.id}, '2', 'Leather Belt', 'https://shop.test/p/2', 'h2', 'belt') returning id::int as id
    `
    const [placeholder] = await piecesOf(belt)
    await recordAction({ action: 'bought', product_id: beltProduct!.id, slot_id: belt }, sql)
    const [real] = await piecesOf(belt)
    assert.notEqual(real!.id, placeholder!.id)
    assert.equal(real!.source, 'find')
  })

  test('a piece photo is stored without metadata, attached once, replaced, and cleared when orphaned', async () => {
    const jpeg = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#f2efe8' } })
      .composite([{ input: await sharp({ create: { width: 360, height: 480, channels: 3, background: '#7d3022' } }).png().toBuffer(), top: 160, left: 120 }])
      .withMetadata({ exif: { IFD0: { Copyright: 'secret' } } })
      .jpeg()
      .toBuffer()
    const stored = await storePiecePhoto({ bytes: jpeg, mime: 'image/jpeg' }, sql)
    assert.ok(stored.path.startsWith('wardrobe/'))
    const meta = await sharp((await files().get(stored.path))!).metadata()
    assert.equal(meta.exif, undefined, 'no metadata survives')
    assert.equal(snapToGuide(stored.colourHex!, guideFixture).hex, '#7a2e1f', 'the oxblood is read on our own server')

    const piece = await createPiece(values(), { source: 'photo', photo_id: stored.id, product_id: null })
    await assert.rejects(createPiece(values(), { source: 'photo', photo_id: stored.id, product_id: null }), PieceError)

    const other = await storePiecePhoto({ bytes: await sharp(jpeg).flop().jpeg().toBuffer(), mime: 'image/jpeg' }, sql)
    await attachPhoto(piece, other.id, sql)
    assert.equal(await files().get(stored.path), null, 'the old photo is deleted')
    assert.equal((await getPiece(piece))?.photo?.id, other.id)

    // A photo read but never saved as a piece goes after a day.
    const orphan = await storePiecePhoto({ bytes: await sharp(jpeg).flip().jpeg().toBuffer(), mime: 'image/jpeg' }, sql)
    await sql`update wardrobe_photos set created_at = now() - interval '2 days' where id = ${orphan.id}`
    assert.equal(await clearOrphans(sql), 1)
    assert.equal(await files().get(orphan.path), null)
    assert.ok(await files().get(other.path))

    const { photoPath: gone } = await deletePiece(piece)
    assert.equal(gone, other.path)
  })
})
