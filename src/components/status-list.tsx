import { connection } from 'next/server'

import { checkAll } from '@/lib/health'

import { TextBone } from './skeleton.tsx'

/**
 * Streams in under Suspense on the You page. connection() keeps the database
 * call out of the prerendered shell.
 */
export async function StatusList() {
  await connection()
  const checks = await checkAll()

  return (
    <ul className="divide-y divide-line">
      {checks.map((check) => (
        <li key={check.name} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="font-medium">{check.name}</p>
            <p className="text-sm text-ink-2">{check.detail}</p>
          </div>
          <p
            className={`flex shrink-0 items-center gap-2 pt-0.5 text-sm tabular-nums ${check.ok ? 'text-ink-2' : 'text-alert'}`}
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${check.ok ? 'bg-accent' : 'bg-alert'}`}
            />
            {check.ok ? `${check.latencyMs} ms` : 'Down'}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function StatusSkeleton() {
  return (
    <ul className="divide-y divide-line" aria-busy aria-label="Checking the systems">
      {['Database', 'Claude', 'Photos'].map((name) => (
        <li key={name} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{name}</p>
            <div className="skeleton">
              <TextBone className="w-48" size="text-sm" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
