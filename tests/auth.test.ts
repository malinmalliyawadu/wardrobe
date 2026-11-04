import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SESSION_TTL_SECONDS,
  appPassword,
  issueSession,
  passwordMatches,
  requestOrigin,
  safeNext,
  sessionIsValid,
} from '../src/lib/auth.ts'

test('blank APP_PASSWORD leaves the gate open', () => {
  assert.equal(appPassword({}), null)
  assert.equal(appPassword({ APP_PASSWORD: '   ' }), null)
  assert.equal(appPassword({ APP_PASSWORD: 'tweed' }), 'tweed')
})

test('a session signed by the password is valid until it expires', async () => {
  const now = Date.UTC(2026, 10, 4)
  const cookie = await issueSession('tweed', now)
  assert.equal(await sessionIsValid(cookie, 'tweed', now + 1000), true)
  assert.equal(await sessionIsValid(cookie, 'tweed', now + SESSION_TTL_SECONDS * 1000 - 1), true)
  assert.equal(await sessionIsValid(cookie, 'tweed', now + SESSION_TTL_SECONDS * 1000), false)
})

test('changing the password signs every device out', async () => {
  const cookie = await issueSession('tweed')
  assert.equal(await sessionIsValid(cookie, 'flannel'), false)
})

test('a forged or mangled cookie is refused', async () => {
  const cookie = await issueSession('tweed')
  const [expiry, signature] = cookie.split('.') as [string, string]
  const later = String(Number(expiry) + 10 ** 12)
  assert.equal(await sessionIsValid(`${later}.${signature}`, 'tweed'), false)
  assert.equal(await sessionIsValid(`${expiry}.${signature.slice(0, -2)}`, 'tweed'), false)
  assert.equal(await sessionIsValid(`${expiry}.not base64!`, 'tweed'), false)
  assert.equal(await sessionIsValid('junk', 'tweed'), false)
  assert.equal(await sessionIsValid('', 'tweed'), false)
  assert.equal(await sessionIsValid(undefined, 'tweed'), false)
})

test('with no password every session is fine', async () => {
  assert.equal(await sessionIsValid(undefined, null), true)
  assert.equal(await passwordMatches('anything', null), true)
})

test('the password must match exactly', async () => {
  assert.equal(await passwordMatches('tweed', 'tweed'), true)
  assert.equal(await passwordMatches('Tweed', 'tweed'), false)
  assert.equal(await passwordMatches('tweed ', 'tweed'), false)
  assert.equal(await passwordMatches('', 'tweed'), false)
})

test('after signing in, only a path on this site', () => {
  assert.equal(safeNext('/blueprint/12?x=1'), '/blueprint/12?x=1')
  assert.equal(safeNext(null), '/')
  assert.equal(safeNext('https://evil.example'), '/')
  assert.equal(safeNext('//evil.example'), '/')
  assert.equal(safeNext('/\\evil.example'), '/')
})

test('redirects name the site the browser asked for, not the container', () => {
  const behindProxy = new Headers({
    host: '0.0.0.0:3000',
    'x-forwarded-host': 'wardrobe.example.nz, internal',
    'x-forwarded-proto': 'https',
  })
  assert.equal(requestOrigin(behindProxy), 'https://wardrobe.example.nz')
  assert.equal(requestOrigin(new Headers({ host: 'localhost:3000' })), 'http://localhost:3000')
})
