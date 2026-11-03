import { photoFile } from '@/lib/photos'

/**
 * GET /photos/:id?v=thumb
 *
 * Photos live outside public/ so they are never served to anyone who guesses
 * a file name once auth exists; this handler is the one door. Content is
 * hashed into the file name, so a given id's bytes never change while the row
 * lives, which is what makes the long cache lifetime honest.
 */
export async function GET(request: Request, context: RouteContext<'/photos/[id]'>): Promise<Response> {
  const { id } = await context.params
  const numeric = Number(id)
  if (!Number.isInteger(numeric)) return new Response('Not found', { status: 404 })

  const variant = new URL(request.url).searchParams.get('v') === 'thumb' ? 'thumb' : 'master'
  const bytes = await photoFile(numeric, variant)
  if (!bytes) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=86400',
    },
  })
}
