import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import sharp from 'sharp'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { removeAllPhotos, removePhoto, storePhoto } from '../src/lib/photos.ts'
import {
  latestTryOns,
  makeTryOn,
  MODEL,
  outputSize,
  placement,
  productImageUrl,
  startTryOn,
  tryOnCost,
  tryOnFile,
  tryOnPrompt,
  tryOnSpend,
} from '../src/lib/try-on.ts'

/*
 * Try-on: the pure parts, then the whole lifecycle against a real Postgres in
 * a scratch database (never the one DATABASE_URL names) and a throwaway
 * PHOTOS_DIR. OpenAI and the shop are a fake fetch: nothing leaves the machine.
 */

describe('the pure parts', () => {
  test('the output keeps his photo’s aspect, in multiples of 16', () => {
    assert.deepEqual(outputSize(1176, 1568), { width: 1152, height: 1536 })
    assert.deepEqual(outputSize(1568, 1176), { width: 1536, height: 1152 })
    assert.deepEqual(outputSize(1000, 1000), { width: 1536, height: 1536 })
    // Past 1:3 the model refuses, so the ratio is held there.
    assert.deepEqual(outputSize(100, 1000), { width: 512, height: 1536 })
  })

  test('cost prices text input, image input and output tokens apart', () => {
    const usd = tryOnCost({
      input_tokens: 2500,
      input_tokens_details: { text_tokens: 500, image_tokens: 2000 },
      output_tokens: 6000,
    })
    // 500 * 5 + 2000 * 8 + 6000 * 30, per million.
    assert.equal(usd, 0.1985)
    // Without the split, every input token is priced as an image token, the dearer rate.
    assert.equal(tryOnCost({ input_tokens: 1000, output_tokens: 0 }), 0.008)
    assert.equal(tryOnCost({}), 0)
  })

  test('the prompt names the piece, puts it in the right place and asks for no flattery', () => {
    const prompt = tryOnPrompt({ title: 'Lucas Chelsea Boot', garment_type: 'boots', colour: 'Dark Brown Suede' })
    assert.match(prompt, /"Lucas Chelsea Boot", in Dark Brown Suede/)
    assert.match(prompt, /pair of shoes in place of the shoes he is wearing/)
    assert.match(prompt, /Do not slim, lengthen, straighten or flatter him/)
    assert.match(prompt, /same colour and shade/)
    assert.equal(placement('overshirt').noun, 'outer layer')
    assert.equal(placement(null).noun, 'piece')
    assert.doesNotMatch(prompt, /[–—]/, 'plain hyphens only')
  })

  test('product photos are asked of the CDN at the size sent', () => {
    assert.equal(
      productImageUrl('//cdn.shopify.com/s/files/1/a.jpg?v=12'),
      'https://cdn.shopify.com/s/files/1/a.jpg?v=12&width=1536',
    )
    assert.equal(productImageUrl('https://shop.test/cdn/shop/files/a.jpg', 800), 'https://shop.test/cdn/shop/files/a.jpg?width=800')
    assert.equal(productImageUrl('https://images.example.com/a.jpg'), 'https://images.example.com/a.jpg')
  })
})

describe('the lifecycle', () => {
  const scratch = `wardrobe_tryon_${process.pid}_${Date.now()}`
  let admin: Sql
  let sql: Sql
  let dir: string
  let productId: number
  let photoId: number
  const savedKey = process.env.OPENAI_API_KEY

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the try-on test')
    admin = connect({ max: 1 })
    await admin.unsafe(`create database ${scratch}`)
    const url = new URL(process.env.DATABASE_URL)
    url.pathname = `/${scratch}`
    execFileSync(process.execPath, ['scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: url.toString() } })
    process.env.DATABASE_URL = url.toString()
    sql = connect({ max: 2 })

    dir = await mkdtemp(path.join(tmpdir(), 'wardrobe-tryon-'))
    process.env.PHOTOS_DIR = dir
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key'

    const [retailer] = await sql<{ id: number }[]>`
      insert into retailers (slug, name, platform, base_url, country, currency)
      values ('shop', 'Shop', 'shopify', 'https://shop.test', 'NZ', 'NZD') returning id::int as id
    `
    const [product] = await sql<{ id: number }[]>`
      insert into products (retailer_id, external_id, title, url, images, content_hash, garment_type)
      values (${retailer!.id}, '1', 'Ink Wool Overshirt', 'https://shop.test/p/1',
              ${sql.json([{ src: '//cdn.shopify.com/s/files/1/overshirt.jpg?v=3' }])}, 'h1', 'overshirt')
      returning id::int as id
    `
    productId = product!.id
  })

  after(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = savedKey
    await sql?.end()
    // storePhoto went through the app's own pool, which points at the scratch database too.
    await db().end()
    await admin.unsafe(`drop database if exists ${scratch} with (force)`)
    await admin.end()
    await rm(dir, { recursive: true, force: true })
  })

  async function jpeg(width: number, height: number, colour: { r: number; g: number; b: number }): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: colour } }).jpeg().toBuffer()
  }

  type Call = { url: string; body: Record<string, unknown> | null }

  /** The shop and OpenAI, faked. `openai` decides OpenAI's answer. */
  function fakeFetch(openai: () => Promise<Response>, calls: Call[]): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null })
      if (url.startsWith('https://cdn.shopify.com/')) {
        // A transparent PNG, as some shops serve: it must reach OpenAI as a JPEG on white.
        const png = await sharp({ create: { width: 2400, height: 3000, channels: 4, background: { r: 30, g: 40, b: 70, alpha: 0.5 } } })
          .png()
          .toBuffer()
        return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
      }
      return openai()
    }) as typeof fetch
  }

  test('nothing starts without a key or a full-length photo', async () => {
    delete process.env.OPENAI_API_KEY
    const noKey = await startTryOn(productId, sql)
    assert.ok(!noKey.ok && /OPENAI_API_KEY/.test(noKey.message))
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key'

    const noPhoto = await startTryOn(productId, sql)
    assert.ok(!noPhoto.ok && /full-length photo/.test(noPhoto.message))
  })

  test('one is made, filed, priced and found again; a second waits its turn', async () => {
    // storePhoto writes through the app's own db(), which now points at the scratch database.
    const photo = await storePhoto({ bytes: await jpeg(1500, 2000, { r: 180, g: 140, b: 100 }), mime: 'image/jpeg', kind: 'full_body' })
    photoId = photo.id

    const started = await startTryOn(productId, sql)
    assert.ok(started.ok)
    const second = await startTryOn(productId, sql)
    assert.ok(!second.ok && /One at a time/.test(second.message), 'one in the making at a time')

    const calls: Call[] = []
    const generated = await jpeg(1152, 1536, { r: 40, g: 50, b: 80 })
    const status = await makeTryOn(started.id, {
      sql,
      fetch: fakeFetch(
        async () =>
          Response.json(
            {
              data: [{ b64_json: generated.toString('base64') }],
              usage: { input_tokens: 2500, input_tokens_details: { text_tokens: 500, image_tokens: 2000 }, output_tokens: 6000 },
            },
            { headers: { 'x-request-id': 'req_123' } },
          ),
        calls,
      ),
    })
    assert.equal(status, 'ready')

    const shop = calls.find((call) => call.url.startsWith('https://cdn.shopify.com/'))
    assert.ok(shop?.url.endsWith('width=1536'))
    const openai = calls.find((call) => call.url === 'https://api.openai.com/v1/images/edits')
    assert.ok(openai?.body)
    assert.equal(openai.body.model, MODEL)
    assert.equal(openai.body.size, '1152x1536', 'his photo is 3:4, so is the answer')
    const images = openai.body.images as { image_url: string }[]
    assert.equal(images.length, 2, 'him, then the product')
    assert.ok(images.every((image) => image.image_url.startsWith('data:image/jpeg;base64,')), 'inline, never a link')
    const sentProduct = await sharp(Buffer.from(images[1]!.image_url.split(',')[1]!, 'base64')).metadata()
    assert.equal(sentProduct.format, 'jpeg')
    assert.equal(sentProduct.height, 1536, 'the product photo is held to the edge sent')

    const [row] = await sql<{ status: string; request_id: string; usd: number; path: string; width: number }[]>`
      select status, request_id, usd::float as usd, path, width from try_ons where id = ${started.id}
    `
    assert.equal(row?.status, 'ready')
    assert.equal(row?.request_id, 'req_123')
    assert.equal(row?.usd, 0.1985)
    assert.equal(row?.width, 1152)
    assert.ok((await readdir(path.join(dir, 'try-ons'))).includes(path.basename(row!.path)))
    const served = await tryOnFile(started.id, sql)
    assert.ok(served && served.byteLength > 0)
    assert.equal((await sharp(served).metadata()).exif, undefined, 'no metadata on the file')

    const onMe = (await latestTryOns([productId], sql)).get(productId)
    assert.equal(onMe?.status, 'ready')
    assert.equal(onMe?.usd, 0.1985)

    const spend = await tryOnSpend(sql)
    assert.equal(spend.count, 1)
    assert.equal(spend.thisMonthUsd, 0.1985)
  })

  test('a refusal ends as a failed row with words for the card, and frees the queue', async () => {
    const started = await startTryOn(productId, sql)
    assert.ok(started.ok)
    const status = await makeTryOn(started.id, {
      sql,
      fetch: fakeFetch(
        async () =>
          Response.json(
            { error: { message: 'Your request was rejected by the safety system.', code: 'moderation_blocked', type: 'image_generation_user_error' } },
            { status: 400 },
          ),
        [],
      ),
    })
    assert.equal(status, 'failed')
    const onMe = (await latestTryOns([productId], sql)).get(productId)
    assert.equal(onMe?.status, 'failed')
    assert.equal(onMe?.error, 'OpenAI declined to make this one.')

    const next = await startTryOn(productId, sql)
    assert.ok(next.ok, 'a failed one does not hold the queue')
    // A request whose server died is called failed once it is stale.
    await sql`update try_ons set started_at = now() - interval '10 minutes' where id = ${next.id}`
    assert.equal((await latestTryOns([productId], sql)).get(productId)?.status, 'failed')
    const swept = await startTryOn(productId, sql)
    assert.ok(swept.ok, 'the stale one was swept')
    await sql`update try_ons set status = 'failed' where id = ${swept.id}`
  })

  test('deleting a photo deletes the try-ons made from it; delete photos deletes them all', async () => {
    const ready = await sql<{ path: string }[]>`select path from try_ons where status = 'ready' and deleted_at is null`
    assert.equal(ready.length, 1)

    // A second photo with its own try-on, then that photo alone deleted.
    const other = await storePhoto({ bytes: await jpeg(1200, 1600, { r: 90, g: 70, b: 50 }), mime: 'image/jpeg', kind: 'full_body' })
    const started = await startTryOn(productId, sql)
    assert.ok(started.ok)
    const image = await jpeg(1152, 1536, { r: 60, g: 60, b: 60 })
    assert.equal(
      await makeTryOn(started.id, {
        sql,
        fetch: fakeFetch(async () => Response.json({ data: [{ b64_json: image.toString('base64') }] }), []),
      }),
      'ready',
    )
    await removePhoto(other.id, sql)
    const [gone] = await sql<{ path: string | null; deleted_at: Date | null; usd: number | null }[]>`
      select path, deleted_at, usd::float as usd from try_ons where id = ${started.id}
    `
    assert.equal(gone?.path, null)
    assert.ok(gone?.deleted_at)
    assert.equal(gone?.usd, null, 'no usage reported, no cost invented')
    assert.equal(await tryOnFile(started.id, sql), null)
    assert.equal((await sql`select 1 from try_ons where photo_id = ${photoId} and deleted_at is null and status = 'ready'`).length, 1, 'the other photo’s stays')

    const removed = await removeAllPhotos(sql)
    assert.deepEqual(removed, { photos: 1, tryOns: 1 })
    assert.deepEqual(await readdir(path.join(dir, 'try-ons')), [], 'no try-on file left')
    assert.equal((await latestTryOns([productId], sql)).size, 0)
    assert.equal((await tryOnSpend(sql)).count, 2, 'deleted images still count toward spend')
  })
})
