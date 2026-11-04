/**
 * The gate: one password, one signed cookie. The single-user stopgap agreed
 * in place of Basic Auth, because an installed iPhone web app handles a Basic
 * Auth prompt badly (it asks again on launch, or never shows it), while a
 * cookie set once keeps the home-screen app signed in for a year.
 *
 * The cookie is `expiry.signature`, an HMAC over the expiry keyed by
 * APP_PASSWORD itself, so there is no second secret to set, a stolen cookie
 * holds no part of the password, and changing the password signs every
 * device out.
 *
 * Nothing here imports the database or node:*: it runs in the proxy, before
 * any route, as well as in the sign-in action. Web Crypto works in both.
 */

export const SESSION_COOKIE = 'wardrobe_session'

/** A year. The point is that the phone never asks again. */
export const SESSION_TTL_SECONDS = 365 * 24 * 60 * 60

const encoder = new TextEncoder()

/**
 * Read on every call, never at module load: the image is built without
 * secrets and run with them. Blank counts as unset, which is how an empty
 * field in a deployment UI looks.
 */
export function appPassword(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.APP_PASSWORD
  return value && value.trim() !== '' ? value : null
}

/** Unset locally, so `npm run dev` is open; set in Coolify, so the site is not. */
export function authEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return appPassword(env) !== null
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }
}

export async function issueSession(password: string, now = Date.now()): Promise<string> {
  const expiry = String(now + SESSION_TTL_SECONDS * 1000)
  return `${expiry}.${toBase64Url(await hmac(password, `session.${expiry}`))}`
}

/** True when the cookie was signed by the password now in force and has not expired. */
export async function sessionIsValid(
  cookie: string | null | undefined,
  password: string | null = appPassword(),
  now = Date.now(),
): Promise<boolean> {
  if (password === null) return true
  if (!cookie) return false
  const parts = cookie.split('.')
  if (parts.length !== 2) return false
  const [expiry, signature] = parts as [string, string]
  // Signature first, so a forgery learns nothing about which part was wrong.
  const provided = fromBase64Url(signature)
  if (provided === null || !equalBytes(await hmac(password, `session.${expiry}`), provided)) return false
  return /^\d+$/.test(expiry) && now < Number(expiry)
}

/**
 * Compares digests rather than the strings, so neither the length nor how far
 * a byte-wise comparison got leaks through the timing.
 */
export async function passwordMatches(attempt: string, password: string | null = appPassword()): Promise<boolean> {
  if (password === null) return true
  const [left, right] = await Promise.all([sha256(attempt), sha256(password)])
  return equalBytes(left, right)
}

/**
 * Where to go after signing in: a path on this site only. `//evil.example`
 * and `/\evil.example` are protocol-relative to a browser, which would make
 * the one page a stranger can reach an open redirect.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

/**
 * The scheme and host the browser asked for. Behind Coolify's proxy the
 * request URL carries the container's own address, so a redirect built from
 * it would send the phone to http://0.0.0.0:3000. Proxies append, so the
 * leftmost forwarded value is the browser-facing one.
 */
export function requestOrigin(headers: Headers): string {
  const first = (value: string | null) => value?.split(',')[0]?.trim() || null
  const host = first(headers.get('x-forwarded-host')) ?? headers.get('host') ?? 'localhost'
  const proto = first(headers.get('x-forwarded-proto')) ?? 'http'
  return `${proto}://${host}`
}

async function hmac(key: string, message: string): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return new Uint8Array(await crypto.subtle.sign('HMAC', material, encoder.encode(message)))
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** Constant time for equal lengths, the only case a real signature reaches. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a[i]! ^ b[i]!
  return difference === 0
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** Null rather than throwing: junk arrives in cookies as a matter of course. */
function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  return new Uint8Array(Buffer.from(value, 'base64url'))
}
