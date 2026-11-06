import { lookImageFile } from '@/lib/look-image'

/**
 * GET /photos/looks/:id
 *
 * A look's picture is drawn from photos of his clothes, so it is served like
 * them: from the photo store, through this one door, never from public/. A
 * new picture is a new row with a new id, so an id's bytes never change.
 */
export async function GET(_request: Request, context: RouteContext<'/photos/looks/[id]'>): Promise<Response> {
  const { id } = await context.params
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) return new Response('Not found', { status: 404 })

  const bytes = await lookImageFile(numeric)
  if (!bytes) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}
