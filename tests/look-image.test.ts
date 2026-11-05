import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import sharp from 'sharp'

import { connect, db, type Sql } from '../src/lib/db.ts'
import {
  latestLookImages,
  LOOK_IMAGE_DIR,
  lookImageFile,
  lookImagePrompt,
  makeLookImage,
  piecesKey,
  startLookImage,
} from '../src/lib/look-image.ts'
import { saveSet } from '../src/lib/looks.ts'
import { createPiece } from '../src/lib/pieces.ts'
import type { PieceSent } from '../src/lib/try-on.ts'

/*
 * A look's picture, the flat lay on the outfit of the day: what is asked
 * for, when a look is drawn again, and a picture made and filed against a
 * scratch database and a scratch photos folder. OpenAI and the shops are
 * fakes; nothing leaves the machine.
 */

const piece = (extra: Partial<PieceSent>): PieceSent => ({
  piece_id: 1,
  name: 'Pine merino crewneck',
  garment_type: 'knitwear',
  colour_name: 'pine',
  colour_hex: '#2f4a3a',
  fabric: 'merino',
  fit: 'regular',
  shown: { kind: 'words' },
  ...extra,
})

describe('the pure parts', () => {
  test('the prompt numbers the photos and describes the rest, with no person in it', () => {
    const prompt = lookImagePrompt({
      title: 'Pine over putty',
      styling: 'Sleeves pushed up.',
      pieces: [
        piece({ piece_id: 1, shown: { kind: 'photo', photo_id: 9 } }),
        piece({ piece_id: 2, name: 'Putty chinos', garment_type: 'trousers', colour_name: 'putty', colour_hex: null, shown: { kind: 'words' } }),
        piece({ piece_id: 3, name: 'Brown derbies', garment_type: 'shoes', colour_name: null, colour_hex: null, shown: { kind: 'product', src: 'https://x/y.jpg' } }),
      ],
    })
    assert.match(prompt, /^Images 1 to 2 are photos of the pieces/)
    assert.match(prompt, /- Image 1: "Pine merino crewneck", the top, pine \(#2f4a3a\)\./)
    assert.match(prompt, /- No photo: "Putty chinos", the trousers, in putty, regular fit, merino\./)
    assert.match(prompt, /- Image 2: "Brown derbies", the pair of shoes\./)
    assert.match(prompt, /Lay it out the way it is worn: Sleeves pushed up\./)
    assert.match(prompt, /No person, no mannequin/)
    assert.doesNotMatch(prompt, /man in image|photo of a man/, 'never a picture of him')
  })

  test('with no photos at all, the prompt says nothing of images', () => {
    assert.match(lookImagePrompt({ title: 'T', styling: null, pieces: [piece({})] }), /^Make a photograph/)
  })

  test('the key changes when a piece gets a photo or a new colour, and only then', () => {
    const words = piecesKey([piece({})])
    assert.equal(piecesKey([piece({})]), words)
    assert.notEqual(piecesKey([piece({ shown: { kind: 'photo', photo_id: 4 } })]), words)
    assert.notEqual(piecesKey([piece({ colour_hex: '#5e1f2a' })]), words)
    assert.equal(piecesKey([piece({ name: 'Renamed' })]), words, 'a new name draws nothing new')
  })
})

describe('a picture made and filed', () => {
  const scratch = `wardrobe_lookimg_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  let dir: string
  let lookId: number
  let productPieceId: number
  const savedKey = process.env.OPENAI_API_KEY

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the look image test')
    admin = connect({ max: 1 })
    await admin.unsafe(`create database ${scratch}`)
    const url = new URL(process.env.DATABASE_URL)
    url.pathname = `/${scratch}`
    execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
    process.env.DATABASE_URL = url.toString()
    sql = connect({ max: 2 })
    dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-lookimg-'))
    process.env.PHOTOS_DIR = dir
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key'

    const [retailer] = await sql<{ id: number }[]>`
      insert into retailers (slug, name, platform, base_url, country, currency)
      values ('shop', 'Shop', 'shopify', 'https://shop.test', 'NZ', 'NZD') returning id::int as id
    `
    const [product] = await sql<{ id: number }[]>`
      insert into products (retailer_id, external_id, title, url, images, content_hash, garment_type)
      values (${retailer!.id}, '1', 'Brown Derby', 'https://shop.test/p/1',
              ${sql.json([{ src: '//cdn.shopify.com/s/files/1/derby.jpg' }])}, 'h1', 'shoes')
      returning id::int as id
    `
    const blank = { colour_hex: null, colour_name: null, fabric: null, fit: null, warmth: null, worn_for: 'everyday' as const, brand: null, size: null, notes: null, slot_id: null }
    const typed = { source: 'typed' as const, photo_id: null, product_id: null }
    const ids = [
      await createPiece({ ...blank, name: 'Pine crew', garment_type: 'knitwear', colour_hex: '#2f4a3a', colour_name: 'pine' }, typed),
      await createPiece({ ...blank, name: 'Putty chinos', garment_type: 'trousers' }, typed),
    ]
    productPieceId = await createPiece({ ...blank, name: 'Brown derbies', garment_type: 'shoes' }, { source: 'link', photo_id: null, product_id: product!.id })
    ids.push(productPieceId)
    const meta = { model: 'claude-opus-5-5', served_by: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, generated_at: '' }
    await saveSet(
      {
        looks: [{ title: 'Pine over putty', occasion: 'office', weather: 'mild', piece_ids: ids, why: 'Why.', styling: null, better_with: null }],
        proposed: 1,
        meta,
        usd: 0.1,
      },
      { note: null, pieces: 3, date: '2026-11-05', weather: 'mild' },
      sql,
    )
    const [look] = await sql<{ id: number }[]>`select id::int as id from looks`
    lookId = look!.id
  })

  after(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = savedKey
    await sql?.end()
    await db().end()
    await admin.unsafe(`drop database if exists ${scratch} with (force)`)
    await admin.end()
    await rm(dir, { recursive: true, force: true })
  })

  type Call = { url: string; body: Record<string, unknown> | null }

  function fakeFetch(calls: Call[], openai: () => Promise<Response>): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null })
      if (url.startsWith('https://cdn.shopify.com/')) {
        const jpeg = await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 90, g: 58, b: 34 } } }).jpeg().toBuffer()
        return new Response(new Uint8Array(jpeg), { headers: { 'content-type': 'image/jpeg' } })
      }
      return openai()
    }) as typeof fetch
  }

  const drawn = async () => {
    const image = await sharp({ create: { width: 1152, height: 1536, channels: 3, background: { r: 240, g: 236, b: 226 } } }).jpeg().toBuffer()
    return Response.json(
      { data: [{ b64_json: image.toString('base64') }], usage: { input_tokens: 1200, input_tokens_details: { text_tokens: 400, image_tokens: 800 }, output_tokens: 1600 } },
      { headers: { 'x-request-id': 'req_look' } },
    )
  }

  test('nothing is drawn without a key', async () => {
    delete process.env.OPENAI_API_KEY
    assert.equal(await startLookImage(lookId, sql), null)
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key'
  })

  test('drawn from the shop photo of one piece and the words of the rest, filed and priced; never twice', async () => {
    const id = await startLookImage(lookId, sql)
    assert.ok(id)
    assert.equal(await startLookImage(lookId, sql), null, 'one in the making is enough')

    const calls: Call[] = []
    assert.equal(await makeLookImage(id, { sql, fetch: fakeFetch(calls, drawn) }), 'ready')
    const openai = calls.find((call) => call.url.startsWith('https://api.openai.com/'))
    assert.equal(openai?.url, 'https://api.openai.com/v1/images/edits')
    assert.equal(openai?.body?.size, '1152x1536')
    assert.equal((openai?.body?.images as unknown[]).length, 1, 'only the shoes have a photo; nothing of him')

    const images = await latestLookImages([lookId], sql)
    assert.deepEqual(
      { ...images.get(lookId), id: undefined },
      { id: undefined, status: 'ready', error: null, width: 1152, height: 1536, usd: 0.0564 },
    )
    assert.ok(await lookImageFile(id, sql))
    assert.equal((await readdir(path.join(dir, LOOK_IMAGE_DIR))).length, 1)
    assert.equal(await startLookImage(lookId, sql), null, 'a look with a picture of its pieces as they are keeps it')
  })

  test('another look of the same pieces, in any order, shows that picture and is never drawn', async () => {
    const [twin] = await sql<{ id: number }[]>`
      insert into looks (set_id, position, title, occasion, weather, why, piece_count)
      select set_id, 1, 'Pine over putty again', 'weekend', 'mild', 'Why.', piece_count from looks where id = ${lookId}
      returning id::int as id
    `
    await sql`
      insert into look_pieces (look_id, piece_id, position)
      select ${twin!.id}, piece_id, 2 - position from look_pieces where look_id = ${lookId}
    `
    assert.equal(await startLookImage(twin!.id, sql), null)
    const images = await latestLookImages([lookId, twin!.id], sql)
    assert.equal(images.get(twin!.id)?.id, images.get(lookId)?.id)
    assert.equal(images.get(twin!.id)?.status, 'ready')
    await sql`delete from looks where id = ${twin!.id}`
  })

  test('a look whose pieces changed is drawn again; with no photo at all it is generated from words', async () => {
    await sql`update wardrobe_pieces set product_id = null where id = ${productPieceId}`
    const id = await startLookImage(lookId, sql)
    assert.ok(id, 'the shoes lost their photo, so the picture is out of date')
    const calls: Call[] = []
    assert.equal(await makeLookImage(id, { sql, fetch: fakeFetch(calls, drawn) }), 'ready')
    const openai = calls.find((call) => call.url.startsWith('https://api.openai.com/'))
    assert.equal(openai?.url, 'https://api.openai.com/v1/images/generations')
    assert.equal(openai?.body?.images, undefined)
  })

  test('a refusal is a failed picture in words, and the next showing tries again', async () => {
    await sql`update wardrobe_pieces set colour_hex = '#5e1f2a' where id = ${productPieceId}`
    const id = await startLookImage(lookId, sql)
    assert.ok(id)
    const error = console.error
    console.error = () => {}
    const warn = console.warn
    console.warn = () => {}
    try {
      const refused = async () => Response.json({ error: { code: 'moderation_blocked' } }, { status: 400 })
      assert.equal(await makeLookImage(id, { sql, fetch: fakeFetch([], refused) }), 'failed')
    } finally {
      console.error = error
      console.warn = warn
    }
    const [failed] = await sql<{ error: string }[]>`select error from look_images where id = ${id}`
    assert.equal(failed?.error, 'OpenAI declined to make this one.')
    assert.equal((await latestLookImages([lookId], sql)).get(lookId)?.status, 'ready', 'the card keeps the picture it has')
    assert.ok(await startLookImage(lookId, sql))
  })
})
