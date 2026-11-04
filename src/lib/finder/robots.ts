/*
 * robots.txt, read the way RFC 9309 says: the group for our product token if
 * there is one, otherwise the "*" group; groups naming the same agent merge;
 * the longest matching rule wins and Allow wins a tie; "*" matches any run of
 * characters and a trailing "$" anchors the end.
 *
 * One deviation, on purpose: some stores serve the file with its lines run
 * together (Workshop's has bare carriage returns in places and nothing at all
 * between most directives). A strict reader would see one long User-agent line
 * and no rules, and allow everything. Splitting before each known directive
 * recovers the rules the store meant, which is the polite reading.
 */

export type RobotsRule = { allow: boolean; pattern: string }

export type Robots = {
  rules: RobotsRule[]
  /** Seconds, if the group asks for one. */
  crawlDelay: number | null
}

// Before each directive that does not already start a line. "allow" is not
// split out of "disallow".
const SPLIT_BEFORE = /(?<!^|\n)(?=(?:user-agent|disallow|crawl-delay|sitemap)\s*:|(?<!dis)allow\s*:)/gi

type Group = { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null }

export function parseRobots(text: string, productToken: string): Robots {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n')
    .replace(SPLIT_BEFORE, '\n')
    .split('\n')

  const groups: Group[] = []
  let current: Group | null = null
  let lastWasAgent = false

  for (const raw of lines) {
    const match = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(raw)
    if (!match) continue
    const key = match[1]!.toLowerCase()
    const value = match[2]!

    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow allows everything; it adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value })
    } else if (key === 'crawl-delay') {
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds
    }
  }

  const token = productToken.toLowerCase()
  const own = groups.filter((group) => group.agents.includes(token))
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'))
  return {
    rules: chosen.flatMap((group) => group.rules),
    crawlDelay: chosen.reduce<number | null>(
      (delay, group) => (group.crawlDelay === null ? delay : Math.max(delay ?? 0, group.crawlDelay)),
      null,
    ),
  }
}

/** Path plus query, e.g. "/products.json?limit=250&page=2". */
export function isAllowed(robots: Robots, path: string): boolean {
  if (path === '/robots.txt') return true
  let best: RobotsRule | null = null
  let bestLength = -1
  for (const rule of robots.rules) {
    if (!matches(rule.pattern, path)) continue
    const length = rule.pattern.length
    if (length > bestLength || (length === bestLength && rule.allow && !best?.allow)) {
      best = rule
      bestLength = length
    }
  }
  return best?.allow ?? true
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(safeDecode(path))
}

function safeDecode(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}
