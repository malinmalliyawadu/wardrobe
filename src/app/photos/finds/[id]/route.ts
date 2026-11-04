import { findPhotoFile } from '@/lib/find-photos'
import { THUMB_EDGE } from '@/lib/photos'

/**
 * GET /photos/finds/:id?w=320
 *
 * The photo of a find he added by hand. Like his own photos, these live
 * outside public/ and this handler is the one door. `w` is the width
 * next/image asks for: the thumb serves anything it covers, the master the
 * rest. The file name is the content hash and a new photo is a new id, so an
 * id's bytes never change.
 */
export async function GET(request: Request, context: RouteContext<'/photos/finds/[id]'>): Promise<Response> {
  const { id } = await context.params
  const numeric = Number(id)
  if (!Number.isInteger(numeric)) return new Response('Not found', { status: 404 })

  const width = Number(new URL(request.url).searchParams.get('w'))
  const variant = Number.isFinite(width) && width > 0 && width <= THUMB_EDGE ? 'thumb' : 'master'
  const bytes = await findPhotoFile(numeric, variant)
  if (!bytes) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}
