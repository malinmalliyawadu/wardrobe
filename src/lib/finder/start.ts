import { spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'

/*
 * "Run now" on /you/finder. It starts the nightly script itself, as a child
 * of the web server, rather than running the finder inside a request: the
 * script is what the scheduled task runs, so a run started here is the same
 * run in every respect, with the same lock, budget and log lines. Its output
 * goes to the server's own, so it lands in the container log beside the
 * requests that started it.
 *
 * The answer waits only for the script to say it has started (its first
 * line), so the page can show the run at once. A run outlives the request;
 * if the server stops, the run stops with it, and the next run closes its row.
 */

export type StartResult = { ok: true; id: number } | { ok: false; message: string }

/** Long enough to connect and insert one row; much longer means the database is unreachable. */
const START_TIMEOUT_MS = 30_000

export function startFinderRun(): Promise<StartResult> {
  const script = path.join(process.cwd(), 'scripts', 'find.ts')
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return new Promise<StartResult>((resolve) => {
    let settled = false
    const errors: string[] = []
    const settle = (result: StartResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      settle({ ok: false, message: 'The finder did not start within 30 seconds. Check the database is up.' })
    }, START_TIMEOUT_MS)

    createInterface({ input: child.stdout }).on('line', (line) => {
      process.stdout.write(line + '\n')
      const event = parseEvent(line)
      if (event?.event === 'find.start' && typeof event.run === 'number') settle({ ok: true, id: event.run })
      if (event?.event === 'find.busy') settle({ ok: false, message: 'A run is already going.' })
    })
    createInterface({ input: child.stderr }).on('line', (line) => {
      process.stderr.write(line + '\n')
      if (errors.length < 40) errors.push(line)
    })

    child.on('error', (error) => settle({ ok: false, message: `The finder could not start: ${error.message}` }))
    // 'close', not 'exit': it waits for the output to be read to the end.
    child.on('close', (code) => {
      // Node prints an uncaught error as its source line, a caret, then "Error: why".
      const why = errors.find((line) => /^\w*Error\b/.test(line.trim()))?.trim()
      settle({ ok: false, message: `The finder stopped before it started (exit ${code})${why ? `: ${why}` : '.'}` })
    })
  })
}

function parseEvent(line: string): { event?: unknown; run?: unknown } | null {
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === 'object' ? (value as { event?: unknown; run?: unknown }) : null
  } catch {
    return null
  }
}
