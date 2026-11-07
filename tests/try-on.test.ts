import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import sharp from 'sharp'

import { connect, db, type Sql } from '../src/lib/db.ts'
import { buildCutRequest, readsCut, type Cut, type CutListing, type CutReader } from '../src/lib/garment-cut.ts'
import { getOnMe, keptOutfits, listOnMe, outfitTitle } from '../src/lib/on-me.ts'
import { lookOutfitKey, outfitKey } from '../src/lib/outfit-key.ts'
import { removeAllPhotos, removePhoto, storePhoto } from '../src/lib/photos.ts'
import { statementOutfitKey } from '../src/lib/statements.ts'
import {
  getTryOn,
  layer,
  latestLookTryOns,
  latestTryOns,
  lookTryOnPrompt,
  makeTryOn,
  MAX_GARMENT_IMAGES,
  MODEL,
  outfitTryOnPrompt,
  outputSize,
  placement,
  productImageUrl,
  showPieces,
  startAgain,
  startLookTryOn,
  startOutfitTryOn,
  startStatementTryOn,
  startTryOn,
  tryOnCost,
  tryOnFile,
  tryOnPrompt,
  tryOnSpend,
  tryOnsByKey,
} from '../src/lib/try-on.ts'

/*
 * Try-on: the pure parts, then the whole lifecycle against a real Postgres in
 * a scratch database (never the one DATABASE_URL names) and a throwaway
 * PHOTOS_DIR. OpenAI and the shop are a fake fetch, and Claude's read of a
 * find's cut a fake reader: nothing leaves the machine.
 */

const noCut: CutReader = async () => null

const OVERSIZED: Cut = {
  fit: 'oversized',
  silhouette: 'Shoulder seams dropped well down the upper arm; a wide, boxy body with room at the chest; sleeves stack at the wrist; hem at the top of the thigh',
}

describe('the pure parts', () => {
  test('an outfit is keyed by its pieces and finds in any order, sorted as Postgres sorts with collate C', () => {
    assert.equal(outfitKey([{ piece_id: 10 }, { piece_id: null, product_id: 3 }, { piece_id: 9 }]), 'f3,p10,p9')
    assert.equal(outfitKey([{ piece_id: 9 }, { piece_id: 10 }, { piece_id: null, product_id: 3 }]), 'f3,p10,p9')
  })

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

  test('a look shows each piece by his photo, else the shop’s, else in words, within the image limit', () => {
    const base = { name: 'x', garment_type: 'tee', colour_name: null, colour_hex: null, fabric: null, fit: null }
    const shown = showPieces([
      { ...base, piece_id: 1, photo_id: 7, image: '//cdn.shopify.com/a.jpg' },
      { ...base, piece_id: 2, photo_id: null, image: '//cdn.shopify.com/b.jpg' },
      { ...base, piece_id: 3, photo_id: null, image: null },
    ]).map((piece) => piece.shown)
    assert.deepEqual(shown, [
      { kind: 'photo', photo_id: 7 },
      { kind: 'product', src: '//cdn.shopify.com/b.jpg' },
      { kind: 'words' },
    ])
    const many = showPieces(Array.from({ length: MAX_GARMENT_IMAGES + 2 }, (_, i) => ({ ...base, piece_id: i, photo_id: i, image: null })))
    assert.equal(many.filter((piece) => piece.shown.kind !== 'words').length, MAX_GARMENT_IMAGES, 'him and fifteen pieces at most')
  })

  test('the look prompt numbers the photos, describes the rest and asks for no flattery', () => {
    const prompt = lookTryOnPrompt({
      title: 'Navy and putty office day',
      styling: 'Tuck the tee.',
      pieces: [
        { piece_id: 1, name: 'Ink overshirt', garment_type: 'overshirt', colour_name: 'ink navy', colour_hex: '#1f2942', fabric: null, fit: null, shown: { kind: 'photo', photo_id: 1 } },
        { piece_id: 2, name: 'White tee', garment_type: 'tee', colour_name: 'chalk', colour_hex: '#f4f1ea', fabric: 'cotton', fit: 'regular', shown: { kind: 'words' } },
        { piece_id: 3, name: 'Putty chinos', garment_type: 'trousers', colour_name: null, colour_hex: null, fabric: null, fit: null, shown: { kind: 'product', src: 'x' } },
      ],
    })
    assert.match(prompt, /Images 2 to 3 are photos of clothes he owns/)
    assert.match(prompt, /- Image 2: "Ink overshirt", the outer layer, ink navy \(#1f2942\)\./)
    assert.match(prompt, /- No photo: "White tee", the top, in chalk \(#f4f1ea\), regular fit, cotton\./)
    assert.match(prompt, /- Image 3: "Putty chinos", the trousers\./)
    assert.match(prompt, /Wear it this way: Tuck the tee\./)
    assert.match(prompt, /Do not slim, lengthen, straighten or flatter him/)
    assert.doesNotMatch(prompt, /[–—]/, 'plain hyphens only')
  })

  test('pieces he chose go on in place of what he wears, and nothing else changes', () => {
    const jacket = { piece_id: null, product_id: 9, name: 'Field Jacket', garment_type: 'jacket', colour_name: 'olive', colour_hex: null, fabric: null, fit: null, shown: { kind: 'product', src: 'x' } } as const
    const tee = { piece_id: 2, name: 'Chalk tee', garment_type: 'tee', colour_name: 'chalk', colour_hex: '#f4f1ea', fabric: null, fit: null, shown: { kind: 'photo', photo_id: 1 } } as const
    const both = outfitTryOnPrompt([jacket, tee])
    assert.match(both, /Images 2 to 3 are photos of clothes: some he owns, .* and some a shop's photo of a piece he is thinking of buying\./)
    assert.match(both, /wearing these pieces together/)
    assert.match(both, /- Image 2: "Field Jacket", the outer layer, olive\./)
    assert.match(both, /- Image 3: "Chalk tee", the top, chalk \(#f4f1ea\)\./)
    assert.match(both, /layered in the order listed, the outer layer over the rest\. Change nothing else he is wearing\./)
    assert.match(both, /Do not slim, lengthen, straighten or flatter him/)
    assert.doesNotMatch(both, /[–—]/, 'plain hyphens only')

    const one = outfitTryOnPrompt([jacket])
    assert.match(one, /Image 2 is a shop's photo of a piece he is thinking of buying\./)
    assert.match(one, /wearing this piece, so he can judge honestly how it looks on him\. The piece:/)
    assert.match(one, /in place of the matching thing he is wearing\. Change nothing else he is wearing\./)

    assert.ok(layer('coat') < layer('jacket') && layer('jacket') < layer('knitwear') && layer('knitwear') < layer('tee'))
    assert.ok(layer('tee') < layer('jeans') && layer('jeans') < layer('boots') && layer('boots') < layer('bag'))
    assert.equal(outfitTitle(['Field Jacket', 'Chalk tee', 'Putty chinos']), 'Field Jacket, Chalk tee and Putty chinos')
    assert.equal(outfitTitle(['Field Jacket']), 'Field Jacket')
  })

  test('a find whose cut was read says it in positions, and the editor is told not to take it in', () => {
    const shirt = { title: 'Phillip Washed Cotton Overshirt Green', garment_type: 'overshirt', colour: 'Green' }
    const plain = tryOnPrompt(shirt)
    assert.match(plain, /what he puts on keeps its own cut and volume/, 'his build is his body, not the clothes')
    assert.match(plain, /Let it keep the cut image 2 shows, on his frame: .* never taken in to his shape\./)

    const cut = tryOnPrompt(shirt, OVERSIZED)
    assert.match(cut, /Its cut, as the shop photographs it: oversized\. Shoulder seams dropped well down the upper arm; .* hem at the top of the thigh\. Keep exactly that cut on him/)
    assert.match(cut, /never take it in to his shape/)
    assert.doesNotMatch(cut, /Let it keep the cut image 2 shows/, 'one fit line, not two')
    assert.doesNotMatch(cut, /[–—]/, 'plain hyphens only')

    const jacket = { piece_id: null, product_id: 9, name: 'Field Jacket', garment_type: 'jacket', colour_name: 'olive', colour_hex: null, fabric: null, fit: null, shown: { kind: 'product', src: 'x' } } as const
    const tee = { piece_id: 2, name: 'Chalk tee', garment_type: 'tee', colour_name: 'chalk', colour_hex: null, fabric: null, fit: 'relaxed', shown: { kind: 'photo', photo_id: 1 } } as const
    const outfit = outfitTryOnPrompt([jacket, tee], new Map([[9, OVERSIZED]]))
    assert.match(outfit, /- Image 2: "Field Jacket", the outer layer, olive, oversized fit\. Cut as photographed: Shoulder seams .* thigh\./)
    assert.match(outfit, /- Image 3: "Chalk tee", the top, chalk, relaxed fit\./, 'a piece of his says the fit he filed')
    assert.match(outfit, /Let each piece keep its own cut, .* never taken in to his shape/)

    // A cut is a garment's, read from a shop's photo only.
    assert.ok(readsCut('overshirt', '//cdn.shopify.com/a.jpg'))
    assert.ok(!readsCut('boots', '//cdn.shopify.com/a.jpg'), 'shoes have no cut to read')
    assert.ok(!readsCut('jacket', '/photos/finds/12'), 'his own photo of a find goes nowhere but the editor')

    const request = buildCutRequest({
      product_id: 1,
      image: '//cdn.shopify.com/s/files/1/phillip.jpg?v=1',
      title: 'Phillip Washed Cotton Overshirt Green',
      garment_type: 'overshirt',
      body_html: '<p>Pictured: Size L&nbsp;</p><p>Ace’s Height: 185cm. Chest: 94cm.</p>',
      tags: ['Mens'],
    })
    const [image, words] = request.messages[0]!.content
    assert.deepEqual(image, { type: 'image', source: { type: 'url', url: 'https://cdn.shopify.com/s/files/1/phillip.jpg?v=1&width=1024' } })
    assert.ok(words?.type === 'text' && words.text.includes('"description": "Pictured: Size L\\nAce’s Height: 185cm. Chest: 94cm."'), 'the listing as plain text')
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

  test('one is made, filed, priced and found again; a second tap opens it; another waits its turn', async () => {
    // storePhoto writes through the app's own db(), which now points at the scratch database.
    const photo = await storePhoto({ bytes: await jpeg(1500, 2000, { r: 180, g: 140, b: 100 }), mime: 'image/jpeg', kind: 'full_body' })
    photoId = photo.id

    const started = await startTryOn(productId, sql)
    assert.ok(started.ok)
    const second = await startTryOn(productId, sql)
    assert.ok(second.ok && second.reused && second.id === started.id, 'a second tap is the one being made')
    const another = await startTryOn(productId, sql, { again: true })
    assert.ok(!another.ok && /One at a time/.test(another.message), 'one in the making at a time')

    const calls: Call[] = []
    const generated = await jpeg(1152, 1536, { r: 40, g: 50, b: 80 })
    const status = await makeTryOn(started.id, {
      sql,
      readCut: noCut,
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
    const started = await startTryOn(productId, sql, { again: true })
    assert.ok(started.ok && !started.reused)
    const status = await makeTryOn(started.id, {
      sql,
      readCut: noCut,
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
    const failed = await getTryOn(started.id, sql)
    assert.equal(failed?.status, 'failed')
    assert.equal(failed?.error, 'OpenAI declined to make this one.')
    assert.equal((await latestTryOns([productId], sql)).get(productId)?.status, 'ready', 'the card keeps the picture it has')

    const next = await startTryOn(productId, sql, { again: true })
    assert.ok(next.ok, 'a failed one does not hold the queue')
    // A request whose server died is called failed once it is stale.
    await sql`update try_ons set started_at = now() - interval '10 minutes' where id = ${next.id}`
    assert.equal((await getTryOn(next.id, sql))?.status, 'failed')
    const swept = await startTryOn(productId, sql, { again: true })
    assert.ok(swept.ok, 'the stale one was swept')
    await sql`update try_ons set status = 'failed' where id = ${swept.id}`
  })

  test('deleting a photo deletes the try-ons made from it; delete photos deletes them all', async () => {
    const ready = await sql<{ path: string }[]>`select path from try_ons where status = 'ready' and deleted_at is null`
    assert.equal(ready.length, 1)

    // A second photo with its own try-on, then that photo alone deleted.
    const other = await storePhoto({ bytes: await jpeg(1200, 1600, { r: 90, g: 70, b: 50 }), mime: 'image/jpeg', kind: 'full_body' })
    const started = await startTryOn(productId, sql, { again: true })
    assert.ok(started.ok)
    const image = await jpeg(1152, 1536, { r: 60, g: 60, b: 60 })
    assert.equal(
      await makeTryOn(started.id, {
        sql,
        readCut: noCut,
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

  test('a look is made from his photo and its pieces’ photos, in order, and found again', async () => {
    const photo = await storePhoto({ bytes: await jpeg(1200, 1600, { r: 150, g: 120, b: 90 }), mime: 'image/jpeg', kind: 'full_body' })

    // One piece he photographed, one bought from the shop, one typed in.
    await mkdir(path.join(dir, 'wardrobe'), { recursive: true })
    await writeFile(path.join(dir, 'wardrobe', 'tee.jpg'), await jpeg(1176, 1568, { r: 240, g: 238, b: 230 }))
    const [wardrobePhoto] = await sql<{ id: number }[]>`
      insert into wardrobe_photos (path, bytes, width, height, sha256)
      values ('wardrobe/tee.jpg', 1, 1176, 1568, 'tee') returning id::int as id
    `
    const pieces = await sql<{ id: number }[]>`
      insert into wardrobe_pieces ${sql([
        { name: 'Ink Wool Overshirt', garment_type: 'overshirt', source: 'find', product_id: productId, photo_id: null, colour_name: 'ink navy' },
        { name: 'Chalk tee', garment_type: 'tee', source: 'photo', product_id: null, photo_id: wardrobePhoto!.id, colour_name: 'chalk' },
        { name: 'Putty chinos', garment_type: 'trousers', source: 'typed', product_id: null, photo_id: null, colour_name: 'putty' },
      ])}
      returning id::int as id
    `
    const [set] = await sql<{ id: number }[]>`insert into look_sets (model) values ('test') returning id::int as id`
    const [look] = await sql<{ id: number }[]>`
      insert into looks (set_id, position, title, occasion, weather, why, piece_count)
      values (${set!.id}, 0, 'Navy and putty', 'office', 'mild', 'Because.', 3) returning id::int as id
    `
    // The overshirt is outermost, so it comes first even though the tee was added second.
    await sql`
      insert into look_pieces ${sql(pieces.map((piece, position) => ({ look_id: look!.id, piece_id: piece.id, position })))}
    `

    const started = await startLookTryOn(look!.id, sql)
    assert.ok(started.ok)
    const calls: Call[] = []
    const generated = await jpeg(1152, 1536, { r: 40, g: 50, b: 80 })
    const status = await makeTryOn(started.id, {
      sql,
      readCut: noCut,
      fetch: fakeFetch(async () => Response.json({ data: [{ b64_json: generated.toString('base64') }], usage: { input_tokens: 1000, output_tokens: 1000 } }), calls),
    })
    assert.equal(status, 'ready')

    const openai = calls.find((call) => call.url === 'https://api.openai.com/v1/images/edits')
    const images = openai!.body!.images as { image_url: string }[]
    assert.equal(images.length, 3, 'him, the shop’s overshirt, his tee; the chinos in words')
    const colourOf = async (index: number) => {
      const { dominant } = await sharp(Buffer.from(images[index]!.image_url.split(',')[1]!, 'base64')).stats()
      return dominant
    }
    assert.ok((await colourOf(2)).r > 200, 'the third image is his photo of the chalk tee')
    assert.match(String(openai!.body!.prompt), /- No photo: "Putty chinos", the trousers, in putty\./)

    const [row] = await sql<{ product_id: number | null; look_id: number; pieces: { shown: { kind: string } }[] }[]>`
      select product_id, look_id::int as look_id, pieces from try_ons where id = ${started.id}
    `
    assert.equal(row?.product_id, null)
    assert.deepEqual(row?.pieces.map((piece) => piece.shown.kind), ['product', 'photo', 'words'])
    assert.equal((await latestLookTryOns([look!.id], sql)).get(look!.id)?.status, 'ready')
    assert.equal((await latestTryOns([productId], sql)).size, 0, 'a look’s try-on is not the find’s')

    // The same pieces again, on the look, on another look in another order, or chosen: that picture, never a new one.
    const [{ key } = { key: '' }] = await sql<{ key: string }[]>`select ${lookOutfitKey(sql)} as key from looks l where l.id = ${look!.id}`
    assert.equal(key, outfitKey(pieces.map((piece) => ({ piece_id: piece.id }))), 'Postgres keys a look as the app does')
    const tapped = await startLookTryOn(look!.id, sql)
    assert.ok(tapped.ok && tapped.reused && tapped.id === started.id)
    const [twin] = await sql<{ id: number }[]>`
      insert into looks (set_id, position, title, occasion, weather, why, piece_count)
      values (${set!.id}, 1, 'Navy and putty again', 'weekend', 'mild', 'Because.', 3) returning id::int as id
    `
    await sql`
      insert into look_pieces ${sql([...pieces].reverse().map((piece, position) => ({ look_id: twin!.id, piece_id: piece.id, position })))}
    `
    assert.equal((await latestLookTryOns([twin!.id], sql)).get(twin!.id)?.id, started.id, 'a twin look shows the picture')
    const twinTapped = await startLookTryOn(twin!.id, sql)
    assert.ok(twinTapped.ok && twinTapped.reused && twinTapped.id === started.id)
    const chosen = await startOutfitTryOn({ piece_ids: pieces.map((piece) => piece.id), product_ids: [] }, sql)
    assert.ok(chosen.ok && chosen.reused && chosen.id === started.id, 'chosen piece by piece, it is the same picture')
    assert.equal((await keptOutfits(sql))[key], started.id, 'and the chooser knows it')
    const again = await startLookTryOn(look!.id, sql, { again: true })
    assert.ok(again.ok && !again.reused && again.id !== started.id, '"Make it again" makes another')
    await sql`update try_ons set status = 'failed', error = 'Stopped.' where id = ${again.id}`
    assert.equal((await latestLookTryOns([look!.id], sql)).get(look!.id)?.id, started.id, 'a failed one does not hide the picture')

    // A piece gone from the wardrobe: the look is no longer whole, so it is not made.
    await sql`delete from wardrobe_pieces where id = ${pieces[2]!.id}`
    const gone = await startLookTryOn(look!.id, sql)
    assert.ok(!gone.ok && /no longer in your wardrobe/.test(gone.message))

    // And it goes with his photos like any other.
    await removePhoto(photo.id, sql)
    assert.equal((await latestLookTryOns([look!.id], sql)).size, 0)
  })

  test('pieces and saved finds he chose are put on in layer order, listed with their sources, and made again', async () => {
    const photo = await storePhoto({ bytes: await jpeg(1200, 1600, { r: 140, g: 110, b: 85 }), mime: 'image/jpeg', kind: 'full_body' })

    // A saved find with no garment type of its own: it takes its slot's.
    const [retailer] = await sql<{ id: number }[]>`select id::int as id from retailers limit 1`
    const [slot] = await sql<{ id: number }[]>`
      insert into blueprint_slots (position, name, why, priority, garment_type, source)
      values (0, 'Olive field jacket', 'Because.', 1, 'jacket', 'claude') returning id::int as id
    `
    const [jacket, unsaved] = await sql<{ id: number }[]>`
      insert into products ${sql([
        { retailer_id: retailer!.id, external_id: '2', title: 'Field Jacket', url: 'https://shop.test/p/2', images: sql.json([{ src: '//cdn.shopify.com/s/files/1/jacket.jpg' }]), content_hash: 'h2' },
        { retailer_id: retailer!.id, external_id: '3', title: 'Not saved', url: 'https://shop.test/p/3', images: sql.json([]), content_hash: 'h3' },
      ])}
      returning id::int as id
    `
    await sql`insert into feed_actions (product_id, slot_id, action) values (${jacket!.id}, ${slot!.id}, 'saved')`
    await sql`insert into feed_actions (product_id, action, reason) values (${unsaved!.id}, 'dismissed', 'colour')`

    await writeFile(path.join(dir, 'wardrobe', 'grey-tee.jpg'), await jpeg(1176, 1568, { r: 230, g: 230, b: 228 }))
    const [teePhoto] = await sql<{ id: number }[]>`
      insert into wardrobe_photos (path, bytes, width, height, sha256)
      values ('wardrobe/grey-tee.jpg', 1, 1176, 1568, 'grey-tee') returning id::int as id
    `
    const [tee, aside] = await sql<{ id: number }[]>`
      insert into wardrobe_pieces ${sql([
        { name: 'Grey tee', garment_type: 'tee', source: 'photo', photo_id: teePhoto!.id, colour_name: 'grey', set_aside_at: null },
        { name: 'Old jumper', garment_type: 'knitwear', source: 'typed', photo_id: null, colour_name: 'navy', set_aside_at: new Date() },
      ])}
      returning id::int as id
    `

    const none = await startOutfitTryOn({ piece_ids: [], product_ids: [] }, sql)
    assert.ok(!none.ok && /at least one/.test(none.message))
    const setAside = await startOutfitTryOn({ piece_ids: [aside!.id], product_ids: [] }, sql)
    assert.ok(!setAside.ok && /no longer in your wardrobe or saved/.test(setAside.message), 'a set-aside piece is not offered')
    const notSaved = await startOutfitTryOn({ piece_ids: [], product_ids: [unsaved!.id] }, sql)
    assert.ok(!notSaved.ok && /no longer in your wardrobe or saved/.test(notSaved.message), 'only finds still saved')

    // Chosen tee first, but the jacket is the outer layer, so it goes first.
    const started = await startOutfitTryOn({ piece_ids: [tee!.id], product_ids: [jacket!.id, jacket!.id] }, sql)
    assert.ok(started.ok)
    const busy = await startOutfitTryOn({ piece_ids: [tee!.id], product_ids: [] }, sql)
    assert.ok(!busy.ok && /One at a time/.test(busy.message))

    const [row] = await sql<{ product_id: number | null; look_id: number | null; pieces: { piece_id: number | null; product_id?: number; garment_type: string; shown: { kind: string } }[]; prompt: string }[]>`
      select product_id, look_id, pieces, prompt from try_ons where id = ${started.id}
    `
    assert.equal(row?.product_id, null)
    assert.equal(row?.look_id, null)
    assert.deepEqual(row?.pieces.map((piece) => [piece.piece_id, piece.product_id ?? null, piece.garment_type, piece.shown.kind]), [
      [null, jacket!.id, 'jacket', 'product'],
      [tee!.id, null, 'tee', 'photo'],
    ])
    assert.match(row!.prompt, /Change nothing else he is wearing/)

    const calls: Call[] = []
    const generated = await jpeg(1152, 1536, { r: 60, g: 70, b: 50 })
    const openai = fakeFetch(async () => Response.json({ data: [{ b64_json: generated.toString('base64') }], usage: { input_tokens: 1000, output_tokens: 1000 } }), calls)
    assert.equal(await makeTryOn(started.id, { sql, readCut: noCut, fetch: openai }), 'ready')
    const edit = calls.find((call) => call.url === 'https://api.openai.com/v1/images/edits')
    assert.equal((edit!.body!.images as unknown[]).length, 3, 'him, the shop’s jacket, his tee')

    const [listed] = (await listOnMe(sql)).filter((image) => image.id === started.id)
    assert.ok(listed)
    assert.equal(listed.status, 'ready')
    assert.deepEqual(listed.subject, { kind: 'outfit', title: 'Field Jacket and Grey tee', count: 2 })
    assert.deepEqual(listed.sources.map((source) => [source.name, source.kind, source.shown, source.href]), [
      ['Field Jacket', 'saved', 'product', 'https://shop.test/p/2'],
      ['Grey tee', 'piece', 'photo', `/wardrobe/${tee!.id}`],
    ])
    assert.equal(listed.sources[1]!.photo?.id, teePhoto!.id)
    assert.equal(listed.sources[0]!.garment_type, 'jacket')
    assert.match((await getOnMe(started.id, sql))!.prompt, /"Grey tee"/)

    // Made again: a new row of the same pieces, shown first while it is made.
    const again = await startAgain(started.id, sql)
    assert.ok(again.ok && again.id !== started.id)
    const [newest] = await listOnMe(sql)
    assert.equal(newest?.id, again.id)
    assert.equal(newest?.status, 'making')
    assert.deepEqual(newest?.sources.map((source) => source.name), ['Field Jacket', 'Grey tee'])
    assert.equal(await makeTryOn(again.id, { sql, readCut: noCut, fetch: openai }), 'ready')

    // A piece gone from the wardrobe stays named on the picture, with nowhere to link.
    await sql`delete from wardrobe_pieces where id = ${tee!.id}`
    const gone = (await listOnMe(sql)).find((image) => image.id === started.id)
    assert.equal(gone?.sources[1]?.href, null)
    assert.equal(gone?.sources[1]?.name, 'Grey tee')

    // A failed request has no picture, so the page leaves it out.
    const failing = await startOutfitTryOn({ piece_ids: [], product_ids: [jacket!.id] }, sql)
    assert.ok(failing.ok)
    await makeTryOn(failing.id, { sql, readCut: noCut, fetch: fakeFetch(async () => Response.json({ error: { message: 'no' } }, { status: 500 }), []) })
    assert.ok(!(await listOnMe(sql)).some((image) => image.id === failing.id))

    // The jacket alone, made: it is the find's picture too.
    const alone = await startOutfitTryOn({ piece_ids: [], product_ids: [jacket!.id] }, sql)
    assert.ok(alone.ok && !alone.reused)
    assert.equal(await makeTryOn(alone.id, { sql, readCut: noCut, fetch: openai }), 'ready')
    assert.equal((await latestTryOns([jacket!.id], sql)).get(jacket!.id)?.id, alone.id)
    const onFind = await startTryOn(jacket!.id, sql)
    assert.ok(onFind.ok && onFind.reused && onFind.id === alone.id, 'See it on me on the find opens it')

    // And they go with his photos like any other.
    await removePhoto(photo.id, sql)
    assert.equal((await listOnMe(sql)).length, 0)
  })
  test('a statement piece goes on with the pieces it wears with, saved or not, and is found again', async () => {
    const photo = await storePhoto({ bytes: await jpeg(1200, 1600, { r: 140, g: 110, b: 85 }), mime: 'image/jpeg', kind: 'full_body' })
    const [retailer] = await sql<{ id: number }[]>`select id::int as id from retailers limit 1`
    const [cardigan] = await sql<{ id: number }[]>`
      insert into products (retailer_id, external_id, title, url, images, content_hash, garment_type)
      values (${retailer!.id}, '10', 'Rust Mohair Cardigan', 'https://shop.test/p/10',
              ${sql.json([{ src: '//cdn.shopify.com/s/files/1/cardigan.jpg' }])}, 'h10', 'knitwear')
      returning id::int as id
    `
    const [chinos, tee, other] = await sql<{ id: number }[]>`
      insert into wardrobe_pieces ${sql([
        { name: 'Stone chinos', garment_type: 'trousers', source: 'typed', photo_id: null, colour_name: 'stone' },
        { name: 'White tee', garment_type: 'tee', source: 'typed', photo_id: null, colour_name: 'white' },
        { name: 'Navy blazer', garment_type: 'tailoring', source: 'typed', photo_id: null, colour_name: 'navy' },
      ])}
      returning id::int as id
    `
    await sql`
      insert into statement_scores (product_id, content_hash, score, qualities, colour_option, why, wears_with, model)
      values (${cardigan!.id}, 'h10', 88, '{colour,texture}', 'Rust', 'Because.', ${[tee!.id, chinos!.id]}::bigint[], 'sonnet')
    `

    const stranger = await startStatementTryOn(cardigan!.id, [tee!.id, other!.id], sql)
    assert.ok(!stranger.ok && /could not be found/.test(stranger.message), 'only pieces a verdict named')
    const none = await startStatementTryOn(cardigan!.id, [], sql)
    assert.ok(!none.ok)

    // Not saved, and still it goes on: outermost first, the colour as judged.
    const started = await startStatementTryOn(cardigan!.id, [tee!.id, chinos!.id], sql)
    assert.ok(started.ok && !started.reused)
    const [row] = await sql<{ outfit_key: string; pieces: { piece_id: number | null; product_id?: number; colour_name: string | null }[]; prompt: string }[]>`
      select outfit_key, pieces, prompt from try_ons where id = ${started.id}
    `
    const key = statementOutfitKey({ product_id: cardigan!.id, wears_with: [{ id: tee!.id }, { id: chinos!.id }] as never })
    assert.equal(row?.outfit_key, key)
    assert.deepEqual(row?.pieces.map((piece) => [piece.piece_id, piece.product_id ?? null]), [
      [null, cardigan!.id],
      [tee!.id, null],
      [chinos!.id, null],
    ])
    assert.equal(row?.pieces[0]?.colour_name, 'Rust')
    assert.match(row!.prompt, /"Rust Mohair Cardigan", the .*, Rust\./)

    const openai = fakeFetch(async () => Response.json({ data: [{ b64_json: (await jpeg(1152, 1536, { r: 90, g: 40, b: 20 })).toString('base64') }] }), [])
    assert.equal(await makeTryOn(started.id, { sql, readCut: noCut, fetch: openai }), 'ready')
    assert.equal((await tryOnsByKey([key], sql)).get(key)?.id, started.id, 'the card finds it by its outfit')
    const second = await startStatementTryOn(cardigan!.id, [chinos!.id, tee!.id], sql)
    assert.ok(second.ok && second.reused && second.id === started.id, 'a second tap opens it')

    // On the On me page it is a find, not a saved one.
    const listed = (await listOnMe(sql)).find((image) => image.id === started.id)
    assert.deepEqual(listed?.sources.map((source) => [source.name, source.kind]), [
      ['Rust Mohair Cardigan', 'find'],
      ['White tee', 'piece'],
      ['Stone chinos', 'piece'],
    ])
    await sql`insert into feed_actions (product_id, action) values (${cardigan!.id}, 'saved')`
    assert.equal((await listOnMe(sql)).find((image) => image.id === started.id)?.sources[0]?.kind, 'saved')

    // Made again, though the find was cleared since.
    await sql`insert into feed_actions (product_id, action) values (${cardigan!.id}, 'cleared')`
    const again = await startAgain(started.id, sql)
    assert.ok(again.ok && again.id !== started.id)
    assert.equal(await makeTryOn(again.id, { sql, readCut: noCut, fetch: openai }), 'ready')

    // A piece set aside since: the card no longer offers it, and the old ask is refused.
    await sql`update wardrobe_pieces set set_aside_at = now() where id = ${chinos!.id}`
    const gone = await startStatementTryOn(cardigan!.id, [tee!.id, chinos!.id], sql)
    assert.ok(!gone.ok && /no longer in your wardrobe/.test(gone.message))

    await removePhoto(photo.id, sql)
  })

  test('a find’s cut is read once before its picture, kept, and sent in the prompt', async () => {
    const photo = await storePhoto({ bytes: await jpeg(1200, 1600, { r: 150, g: 120, b: 90 }), mime: 'image/jpeg', kind: 'full_body' })
    await sql`update products set body_html = ${'<p>Pictured: Size L. Ace’s Height: 185cm.</p>'} where id = ${productId}`
    const asked: CutListing[] = []
    const reader: CutReader = async (listing) => {
      asked.push(listing)
      return { cut: OVERSIZED, model: 'claude-sonnet-5-5', served_by: 'claude-sonnet-5-5', input_tokens: 1800, output_tokens: 120, usd: 0.0048 }
    }
    const calls: Call[] = []
    const openai = fakeFetch(async () => Response.json({ data: [{ b64_json: (await jpeg(1152, 1536, { r: 20, g: 90, b: 50 })).toString('base64') }] }), calls)

    const started = await startTryOn(productId, sql, { again: true })
    assert.ok(started.ok)
    assert.equal(await makeTryOn(started.id, { sql, readCut: reader, fetch: openai }), 'ready')
    assert.equal(asked.length, 1)
    assert.equal(asked[0]?.image, '//cdn.shopify.com/s/files/1/overshirt.jpg?v=3', 'the photo the try-on sends')
    assert.match(asked[0]?.body_html ?? '', /Pictured: Size L/, 'with the listing, which names the size pictured')
    const sent = calls.find((call) => call.url === 'https://api.openai.com/v1/images/edits')?.body?.prompt as string
    assert.match(sent, /Its cut, as the shop photographs it: oversized\. Shoulder seams dropped/)
    const [row] = await sql<{ prompt: string }[]>`select prompt from try_ons where id = ${started.id}`
    assert.equal(row?.prompt, sent, 'the row keeps the prompt as sent')
    const [kept] = await sql<{ fit: string; usd: number }[]>`select fit, usd::float as usd from product_cuts where product_id = ${productId}`
    assert.deepEqual(kept, { fit: 'oversized', usd: 0.0048 })

    // Made again: the cut kept is used, not read again.
    const again = await startAgain(started.id, sql)
    assert.ok(again.ok)
    assert.equal(await makeTryOn(again.id, { sql, readCut: reader, fetch: openai }), 'ready')
    assert.equal(asked.length, 1, 'read once per photo')
    assert.match((await sql<{ prompt: string }[]>`select prompt from try_ons where id = ${again.id}`)[0]!.prompt, /oversized/)

    // A saved find in pieces he chose is read too; a read that fails leaves the general line.
    const [retailer] = await sql<{ id: number }[]>`select id::int as id from retailers limit 1`
    const [coat] = await sql<{ id: number }[]>`
      insert into products (retailer_id, external_id, title, url, images, content_hash, garment_type)
      values (${retailer!.id}, 'coat', 'Wool Car Coat', 'https://shop.test/p/coat',
              ${sql.json([{ src: '//cdn.shopify.com/s/files/1/coat.jpg' }])}, 'hc', 'coat')
      returning id::int as id
    `
    await sql`insert into feed_actions (product_id, action) values (${coat!.id}, 'saved')`
    await sql`insert into feed_actions (product_id, action) values (${productId}, 'saved')`
    const outfit = await startOutfitTryOn({ piece_ids: [], product_ids: [coat!.id, productId] }, sql)
    assert.ok(outfit.ok && !outfit.reused)
    const failing: CutReader = async (listing) => (listing.product_id === coat!.id ? null : reader(listing))
    assert.equal(await makeTryOn(outfit.id, { sql, readCut: failing, fetch: openai }), 'ready')
    const [made] = await sql<{ prompt: string }[]>`select prompt from try_ons where id = ${outfit.id}`
    assert.match(made!.prompt, /- Image 2: "Wool Car Coat", the outer layer\./, 'no read, no cut line')
    assert.match(made!.prompt, /- Image 3: "Ink Wool Overshirt", the outer layer, oversized fit\. Cut as photographed: Shoulder seams/)
    assert.equal((await sql`select 1 from product_cuts where product_id = ${coat!.id}`).length, 0, 'a failed read is not kept')

    await removePhoto(photo.id, sql)
  })
})
