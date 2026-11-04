import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Sql } from '../src/lib/db.ts'
import { loadRates } from '../src/lib/finder/fx.ts'
import { DisallowedError, PoliteClient, USER_AGENT } from '../src/lib/finder/http.ts'
import { isAllowed, parseRobots } from '../src/lib/finder/robots.ts'

test('robots: the longest matching rule wins, Allow wins a tie, and * and $ work', () => {
  const robots = parseRobots(
    [
      'User-agent: *',
      'Disallow: /collections/*sort_by*',
      'Disallow: /checkout',
      'Allow: /checkout/thanks',
      'Disallow: /*.pdf$',
      'Disallow: /private',
      'Allow: /private',
    ].join('\n'),
    'Wardrobe',
  )
  assert.ok(isAllowed(robots, '/products.json?limit=250&page=1'))
  assert.ok(!isAllowed(robots, '/collections/mens?sort_by=price'))
  assert.ok(!isAllowed(robots, '/checkout/step'))
  assert.ok(isAllowed(robots, '/checkout/thanks'), 'longer Allow beats shorter Disallow')
  assert.ok(!isAllowed(robots, '/files/lookbook.pdf'))
  assert.ok(isAllowed(robots, '/files/lookbook.pdf?download=1'), '$ anchors the end')
  assert.ok(isAllowed(robots, '/private'), 'equal length: Allow wins')
})

test('robots: our own group beats *, and groups for the same agent merge', () => {
  const text = [
    'User-agent: *',
    'Disallow: /a',
    '',
    'User-agent: Nutch',
    'Disallow: /',
    '',
    'User-agent: *',
    'Disallow: /b',
  ].join('\n')
  const robots = parseRobots(text, 'Wardrobe')
  assert.ok(!isAllowed(robots, '/a'))
  assert.ok(!isAllowed(robots, '/b'), 'the second * group (Barkers has two) is merged in')
  assert.ok(isAllowed(robots, '/products.json'))

  const ours = parseRobots(`${text}\n\nUser-agent: wardrobe\nDisallow: /products.json\nCrawl-delay: 3`, 'Wardrobe')
  assert.ok(!isAllowed(ours, '/products.json'), 'our token, case-insensitive, takes over from *')
  assert.ok(isAllowed(ours, '/a'))
  assert.equal(ours.crawlDelay, 3)
})

test('robots: a file with its directives run together still reads as the store meant', () => {
  // Workshop's robots.txt, as served on 2026-11-04: a comment, one bare
  // carriage return, then every directive on one line.
  const workshop =
    '# we use Shopify as our ecommerce platform\rUser-agent: *Allow: /Allow: /products/accountDisallow: /adminDisallow: /cart/Disallow: /checkoutDisallow: /collections/*sort_by*Disallow: /*?*oseid=*Sitemap: https://www.workshop.co.nz/sitemap.xmlUser-agent: adsbot-googleAllow: /products/Disallow: /checkout'
  const robots = parseRobots(workshop, 'Wardrobe')
  assert.ok(isAllowed(robots, '/products.json?limit=250&page=3'))
  assert.ok(!isAllowed(robots, '/admin'))
  assert.ok(!isAllowed(robots, '/collections/all?sort_by=created'))
  assert.ok(!isAllowed(robots, '/checkout'), 'Disallow was not split into "Dis" and "allow"')
})

test('robots: a missing or empty file allows everything', () => {
  assert.ok(isAllowed(parseRobots('', 'Wardrobe'), '/products.json'))
  assert.ok(isAllowed(parseRobots('User-agent: *\nDisallow:', 'Wardrobe'), '/products.json'))
})

/**
 * A virtual clock: sleepers wake in time order and the clock jumps to each
 * wake time, so a test of one-a-second pacing runs instantly. Every request is
 * recorded with the time it was made.
 */
function harness(responder: (url: string, call: number) => Response) {
  let clock = 0
  const sleepers: { wake: number; resolve: () => void }[] = []
  let pumping = false
  const pump = () => {
    if (pumping) return
    pumping = true
    setImmediate(() => {
      pumping = false
      sleepers.sort((a, b) => a.wake - b.wake)
      const next = sleepers.shift()
      if (!next) return
      clock = Math.max(clock, next.wake)
      next.resolve()
      if (sleepers.length > 0) pump()
    })
  }
  const calls: { url: string; at: number; ua: string | null }[] = []
  const client = new PoliteClient({
    now: () => clock,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        sleepers.push({ wake: clock + ms, resolve })
        pump()
      }),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, at: clock, ua: new Headers(init?.headers).get('user-agent') })
      return responder(url, calls.length)
    }) as typeof fetch,
  })
  return { client, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

test('polite client: robots.txt once per host, then one request a second, naming the app', async () => {
  const { client, calls } = harness((url) =>
    url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /admin') : json({ products: [] }),
  )
  await Promise.all([
    client.json('https://a.test/products.json?page=1'),
    client.json('https://a.test/products.json?page=2'),
    client.json('https://b.test/products.json?page=1'),
  ])
  const a = calls.filter((call) => call.url.startsWith('https://a.test'))
  assert.deepEqual(
    a.map((call) => call.url.replace('https://a.test', '')),
    ['/robots.txt', '/products.json?page=1', '/products.json?page=2'],
  )
  assert.deepEqual(a.map((call) => call.at), [0, 1000, 2000], 'a second apart on one host')
  assert.equal(calls.find((call) => call.url === 'https://b.test/products.json?page=1')?.at, 1000, 'hosts do not wait for each other')
  assert.ok(calls.every((call) => call.ua === USER_AGENT))
  assert.match(USER_AGENT, /^Wardrobe\//)
})

test('polite client: a disallowed path is never requested', async () => {
  const { client, calls } = harness((url) =>
    url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /products.json') : json({ products: [] }),
  )
  await assert.rejects(client.json('https://a.test/products.json?page=1'), DisallowedError)
  assert.equal(calls.length, 1)
})

test('polite client: a 429 waits for Retry-After before trying again', async () => {
  const { client, calls } = harness((url, call) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
    return call === 2 ? json({}, 429, { 'retry-after': '7' }) : json({ products: [] })
  })
  assert.deepEqual(await client.json('https://a.test/products.json'), { products: [] })
  const pages = calls.filter((c) => c.url.includes('products'))
  assert.equal(pages.length, 2)
  assert.equal(pages[1]!.at - pages[0]!.at, 7000)
})

test('rates: the ECB rate when it answers, the last run when it does not, a high constant failing that', async () => {
  const noRuns = (async () => []) as unknown as Sql
  const answered = (async () =>
    json([{ date: '2026-11-04', base: 'GBP', quote: 'NZD', rate: 2.3848 }])) as unknown as typeof fetch
  assert.deepEqual(await loadRates(noRuns, ['NZD', 'GBP'], answered), {
    rates: { NZD: 1, GBP: 2.3848 },
    source: 'ecb',
    date: '2026-11-04',
  })

  const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
  const lastRun = (async () => [{ fx: { rates: { NZD: 1, GBP: 2.31 }, date: '2026-11-03' } }]) as unknown as Sql
  assert.deepEqual(await loadRates(lastRun, ['GBP'], down), { rates: { NZD: 1, GBP: 2.31 }, source: 'last_run', date: '2026-11-03' })

  const fallback = await loadRates(noRuns, ['GBP'], down)
  assert.equal(fallback.source, 'fallback')
  assert.ok(fallback.rates.GBP! >= 2.3)
  assert.deepEqual((await loadRates(noRuns, ['NZD'], down)).rates, { NZD: 1 }, 'an all-NZD list needs no lookup')
})
