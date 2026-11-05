'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import { FormMessage, Spinner, SubmitButton } from '@/components/form'
import type { LiveRun } from '@/lib/finder/runs'

import { runFinderNow, type RunNowState } from '../actions'

/*
 * Start the finder without waiting for the night. While a run is on, the
 * button gives way to what it is doing, asked of /api/finder/run every few
 * seconds; when it ends, the page is refreshed once so the last run's
 * numbers and the shops' counts are the new ones.
 */

const POLL_MS = 4000

/** The route sends dates as strings. */
function revive(raw: LiveRun): LiveRun {
  return { ...raw, started_at: new Date(raw.started_at) }
}

export function RunNow({ run: initial }: { run: LiveRun | null }) {
  const router = useRouter()
  const [state, action] = useActionState(runFinderNow, null)
  const [run, setRun] = useState(initial)

  // The server's answer wins whenever it names a different run (a refresh
  // after starting one, or after one ends).
  const [seen, setSeen] = useState(initial?.id ?? null)
  if ((initial?.id ?? null) !== seen) {
    setSeen(initial?.id ?? null)
    setRun(initial)
  }

  // A refusal ("a run is already going") is answered by showing that run, so
  // once a run has been on screen, the refusal has said its piece.
  const [answered, setAnswered] = useState<RunNowState>(null)
  if (run && answered !== state) setAnswered(state)

  const runId = run?.id ?? null
  useEffect(() => {
    if (runId === null) return
    let stopped = false
    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/finder/run', { cache: 'no-store' })
        if (!response.ok || stopped) return
        const body = (await response.json()) as { run: LiveRun | null }
        if (stopped) return
        if (body.run?.id === runId) {
          setRun(revive(body.run))
        } else {
          setRun(body.run ? revive(body.run) : null)
          router.refresh()
        }
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [runId, router])

  if (run) return <Running run={run} />

  return (
    <form action={action} className="mt-8 max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-[32ch] text-sm text-ink-2">
          Runs on its own each night. A run now may spend up to the nightly limits again.
        </p>
        <SubmitButton variant="quiet" size="small" pending="Starting" className="shrink-0">
          Run now
        </SubmitButton>
      </div>
      {state && !state.ok && state !== answered ? (
        <div className="mt-4">
          <FormMessage message={state.message} />
        </div>
      ) : null}
    </form>
  )
}

function Running({ run }: { run: LiveRun }) {
  const zone = { timeZone: 'Pacific/Auckland' } as const
  const time = run.started_at.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', ...zone })
  const detail =
    run.stage === 'reading'
      ? 'Reading the shops and sorting out what fits, a few minutes.'
      : run.judged === 0
        ? 'Judging what is new, the most important slots first. New finds reach Finds as they come.'
        : `Judging: ${run.judged.toLocaleString('en-NZ')} so far, US$${run.usd.toFixed(2)}. New finds reach Finds as they come.`
  return (
    <div aria-live="polite" className="mt-8 flex min-h-12 flex-col justify-center">
      <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-ink">
        <Spinner />
        Running since {time}
      </p>
      <p className="mt-0.5 text-sm text-ink-3 tabular-nums">{detail}</p>
    </div>
  )
}
