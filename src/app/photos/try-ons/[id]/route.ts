import { tryOnFile } from '@/lib/try-on'

/**
 * GET /photos/try-ons/:id
 *
 * A try-on is a picture of him, so it is served like his photos: from the
 * photo store, through this one door, never from public/. A remake is a new
 * row with a new id, so a given id's bytes never change while the row lives.
 */
export async function GET(_request: Request, context: RouteContext<'/photos/try-ons/[id]'>): Promise<Response> {
  const { id } = await context.params
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) return new Response('Not found', { status: 404 })

  const bytes = await tryOnFile(numeric)
  if (!bytes) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=86400',
    },
  })
}
