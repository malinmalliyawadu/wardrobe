import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, authEnabled, requestOrigin, sessionIsValid } from './lib/auth.ts'

/**
 * Every request passes here before any route: pages, the RSC payloads of a
 * client navigation, Server Actions (a POST to the page they sit on) and the
 * photo routes, so a page added later is gated because it exists. With
 * APP_PASSWORD unset (local dev) it lets everything through.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (!authEnabled()) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  if (pathname === '/login') return NextResponse.next()
  if (await sessionIsValid(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()

  // A redirect would turn a POST into a GET of the sign-in page and invite a
  // replay of the submission afterwards. 401 says what happened.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const target = pathname === '/' ? '/login' : `/login?${new URLSearchParams({ next: `${pathname}${search}` })}`
  return NextResponse.redirect(new URL(target, requestOrigin(request.headers)))
}

export const config = {
  /*
   * Everything except Next's static output, the liveness check the container
   * health check calls, and what installing the app fetches: the manifest
   * and its icons are sometimes fetched by the phone's OS without the cookie,
   * and gated they would install the app under the sign-in page's name with
   * a screenshot for an icon. None of them say anything about Malin.
   */
  matcher: [
    '/((?!_next/static|_next/image|api/health/live$|manifest\\.webmanifest$|icons/|icon\\.svg$|apple-icon\\.png$|favicon\\.ico$).*)',
  ],
}
