import { piecePhotoFile } from '@/lib/piece-photos'

/**
 * GET /photos/wardrobe/:id?v=thumb
 *
 * A photo of one of his pieces. Like his own photos, these live outside
 * public/ and this handler is the one door. The file name is the content
 * hash and a replaced photo is a new id, so an id's bytes never change.
 */
export async function GET(request: Request, context: RouteContext<'/photos/wardrobe/[id]'>): Promise<Response> {
  const { id } = await context.params
  const numeric = Number(id)
  if (!Number.isInteger(numeric)) return new Response('Not found', { status: 404 })

  const variant = new URL(request.url).searchParams.get('v') === 'thumb' ? 'thumb' : 'master'
  const bytes = await piecePhotoFile(numeric, variant)
  if (!bytes) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=86400',
    },
  })
}
