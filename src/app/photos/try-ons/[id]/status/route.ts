import { getTryOn } from '@/lib/try-on'

/**
 * GET /photos/try-ons/:id/status
 *
 * Whether a try-on is still being made, for the card that asked for it. A
 * route rather than a server action, so polling never queues behind a save.
 */
export async function GET(_request: Request, context: RouteContext<'/photos/try-ons/[id]/status'>): Promise<Response> {
  const { id } = await context.params
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) return Response.json({ error: 'not found' }, { status: 404 })

  const onMe = await getTryOn(numeric)
  if (!onMe) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(onMe, { headers: { 'cache-control': 'no-store' } })
}
