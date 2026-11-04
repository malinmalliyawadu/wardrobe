import { isAllowed, parseRobots, type Robots } from './robots.ts'

/*
 * The finder's only way onto the network for retailer pages. Polite by
 * construction: at most one request a second per host (longer if robots.txt
 * asks), a User-Agent that names the app, robots.txt read once per host per
 * run and respected, and a 429 or 5xx answered by waiting, never by retrying
 * faster.
 *
 * One host is allowed a shorter interval: cdn.shopify.com, Shopify's image
 * CDN, which serves every product photo on every store and is built for page
 * views that fetch dozens at once. The finder reads a 160px thumbnail from it
 * at most five times a second, and only for photos it has not read before.
 */

export const PRODUCT_TOKEN = 'Wardrobe'
export const USER_AGENT = `${PRODUCT_TOKEN}/0.3 (a personal menswear finder for one person; reads /products.json once a night)`

const MIN_INTERVAL_MS = 1000
const HOST_INTERVAL_MS: Record<string, number> = { 'https://cdn.shopify.com': 200 }
const TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 4

export class FetchError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
  }
}

export class DisallowedError extends Error {}

type Host = { next: number; queue: Promise<void>; robots: Promise<Robots> | null; interval: number }

type ClientOptions = {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export class PoliteClient {
  private hosts = new Map<string, Host>()
  private readonly options: ClientOptions

  constructor(options: ClientOptions = {}) {
    this.options = options
  }

  private host(origin: string): Host {
    let host = this.hosts.get(origin)
    if (!host) {
      host = { next: 0, queue: Promise.resolve(), robots: null, interval: HOST_INTERVAL_MS[origin] ?? MIN_INTERVAL_MS }
      this.hosts.set(origin, host)
    }
    return host
  }

  /** Reads and parses robots.txt for the origin, once, however many requests ask at the same time. */
  robots(origin: string): Promise<Robots> {
    const host = this.host(origin)
    host.robots ??= this.request(`${origin}/robots.txt`, { allowMissing: true }).then(async (response) => {
      const robots = parseRobots(response.ok ? await response.text() : '', PRODUCT_TOKEN)
      if (robots.crawlDelay !== null) {
        host.interval = Math.max(host.interval, Math.ceil(robots.crawlDelay * 1000))
      }
      return robots
    })
    return host.robots
  }

  /** GET a JSON document, after checking robots.txt for its path. */
  async json(url: string): Promise<unknown> {
    const target = new URL(url)
    const robots = await this.robots(target.origin)
    if (!isAllowed(robots, target.pathname + target.search)) {
      throw new DisallowedError(`robots.txt disallows ${target.pathname} on ${target.host}`)
    }
    const response = await this.request(url, { allowMissing: false })
    try {
      return await response.json()
    } catch {
      throw new FetchError(`${target.host} answered ${target.pathname} with something that is not JSON`, response.status)
    }
  }

  /** GET a page's HTML (a store with no JSON endpoint, such as Uniqlo), after checking robots.txt for its path. */
  async text(url: string): Promise<string> {
    const target = new URL(url)
    const robots = await this.robots(target.origin)
    if (!isAllowed(robots, target.pathname + target.search)) {
      throw new DisallowedError(`robots.txt disallows ${target.pathname} on ${target.host}`)
    }
    const response = await this.request(url, { allowMissing: false, accept: 'text/html, */*;q=0.8' })
    return response.text()
  }

  /** GET a file's bytes (a product photo), after checking robots.txt for its path. */
  async bytes(url: string): Promise<Buffer> {
    const target = new URL(url)
    const robots = await this.robots(target.origin)
    if (!isAllowed(robots, target.pathname + target.search)) {
      throw new DisallowedError(`robots.txt disallows ${target.pathname} on ${target.host}`)
    }
    const response = await this.request(url, { allowMissing: false })
    return Buffer.from(await response.arrayBuffer())
  }

  private async request(
    url: string,
    { allowMissing, accept = 'application/json, text/plain;q=0.9, image/*;q=0.8' }: { allowMissing: boolean; accept?: string },
  ): Promise<Response> {
    const target = new URL(url)
    const fetcher = this.options.fetch ?? fetch
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await this.slot(target.origin)
      let response: Response
      try {
        response = await fetcher(url, {
          headers: { 'user-agent': USER_AGENT, accept },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (error) {
        lastError = new FetchError(`${target.host}: ${(error as Error).message}`, null)
        await this.backoff(target.origin, attempt, null)
        continue
      }
      if (response.ok || (allowMissing && response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response
      }
      lastError = new FetchError(`${target.host} answered ${response.status} for ${target.pathname}`, response.status)
      await response.body?.cancel()
      if (response.status === 429 || response.status >= 500) {
        await this.backoff(target.origin, attempt, response.headers.get('retry-after'))
        continue
      }
      break
    }
    throw lastError ?? new FetchError(`${target.host}: request failed`, null)
  }

  /** Waits for this host's next free second, in order. */
  private async slot(origin: string): Promise<void> {
    const host = this.host(origin)
    const now = this.options.now ?? Date.now
    const sleep = this.options.sleep ?? defaultSleep
    const turn = host.queue.then(async () => {
      const wait = host.next - now()
      if (wait > 0) await sleep(wait)
      host.next = now() + host.interval
    })
    host.queue = turn.catch(() => {})
    await turn
  }

  /** Pushes the host's next slot back: Retry-After if given, else 5 s, 20 s, 60 s. */
  private async backoff(origin: string, attempt: number, retryAfter: string | null): Promise<void> {
    const host = this.host(origin)
    const now = this.options.now ?? Date.now
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : [5, 20, 60][attempt - 1] ?? 60
    host.next = Math.max(host.next, now() + Math.min(seconds, 300) * 1000)
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
