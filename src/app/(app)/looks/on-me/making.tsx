'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Spinner } from '@/components/form'

/*
 * A picture still being made, in the place it will appear. It asks for the
 * status every few seconds, the way a card does; once the picture is ready
 * the page re-renders with it. A failure stays here in words, since a failed
 * request has no picture and the next render leaves it out.
 */

const POLL_MS = 3000

export function Making({ id, className = '' }: { id: number; className?: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/photos/try-ons/${id}/status`, { cache: 'no-store' })
        if (stopped) return
        if (response.status === 404) {
          // Deleted with his photos meanwhile.
          clearInterval(timer)
          router.refresh()
          return
        }
        if (!response.ok) return
        const next = (await response.json()) as { status: string; error: string | null }
        if (stopped || next.status === 'making') return
        clearInterval(timer)
        if (next.status === 'ready') router.refresh()
        else setError(next.error ?? 'It could not be made this time.')
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [id, router])

  return (
    <div
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-1.5 bg-surface px-4 text-center ${className}`}
    >
      {error ? (
        <>
          <p className="text-[0.9375rem] font-medium text-alert">Not made</p>
          <p className="text-[0.8125rem] leading-snug text-ink-2">{error}</p>
        </>
      ) : (
        <>
          <span className="text-ink-3">
            <Spinner />
          </span>
          <p className="mt-1 text-[0.9375rem] leading-snug font-medium text-ink-2">Putting it on you</p>
          <p className="text-[0.8125rem] leading-snug text-ink-3">About a minute. It carries on if you leave.</p>
        </>
      )}
    </div>
  )
}
