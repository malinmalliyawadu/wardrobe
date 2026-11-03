import postgres from 'postgres'

/**
 * Postgres connections. Server-side only: nothing in this file may be imported
 * into a client component, and the browser never opens a database socket.
 *
 * Two ways in:
 *   db()       the web process's shared pool, created lazily and kept for the
 *              life of the process (stashed on globalThis so `next dev` hot
 *              reloads do not leak pools).
 *   connect()  a fresh connection for a script that will call `.end()` itself.
 */
export type Sql = postgres.Sql

function url(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  }
  return value
}

/**
 * TLS is opt-in via PGSSLMODE, and off by default.
 *
 * The deployed topology is app and Postgres on the same private Docker network
 * inside Coolify, which does not speak TLS. Inferring "not localhost, therefore
 * encrypt" breaks exactly that case, and inferring the opposite would silently
 * send credentials in the clear to a remote host. So it is explicit.
 */
function ssl(): postgres.Options<Record<string, never>>['ssl'] {
  switch (process.env.PGSSLMODE) {
    case 'require':
      return 'require'
    case 'no-verify':
      return { rejectUnauthorized: false }
    case 'prefer':
      return 'prefer'
    default:
      return false
  }
}

export type ConnectOptions = {
  max?: number
  /** Server notices (e.g. from `drop schema ... cascade`). Default: ignored. */
  onnotice?: (notice: postgres.Notice) => void
}

export function connect(options: ConnectOptions = {}): Sql {
  return postgres(url(), {
    max: options.max ?? 4,
    idle_timeout: 20,
    ssl: ssl(),
    // `undefined` in a parameter becomes SQL NULL instead of a thrown error.
    transform: { undefined: null },
    // postgres.js would otherwise console.log every notice, which breaks any
    // script whose stdout is a stream of JSON lines.
    onnotice: options.onnotice ?? (() => {}),
  })
}

const globalForDb = globalThis as typeof globalThis & { __wardrobeSql?: Sql }

export function db(): Sql {
  globalForDb.__wardrobeSql ??= connect({ max: 10 })
  return globalForDb.__wardrobeSql
}
