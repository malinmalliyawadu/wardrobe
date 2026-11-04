'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { startDayOutfit } from '@/app/day-actions'

/**
 * Starts the day's outfit when Today is first opened on a day that has none,
 * then refreshes so the page shows it in the making. An action rather than a
 * side effect of rendering, so a prefetch never starts one. The server leaves
 * a day that already has an outfit alone, so a second tab costs nothing. A
 * page hidden by <Activity> runs no effects, so nothing starts unseen.
 */
export function Starter() {
  const router = useRouter()
  const sent = useRef(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    startDayOutfit()
      .then((result) => {
        if (result.ok) router.refresh()
        else setMessage(result.message ?? 'It could not be started. Reload to try again.')
      })
      .catch(() => setMessage('It could not be started. Reload to try again.'))
  }, [router])

  return message ? (
    <p role="alert" className="mt-4 text-[0.9375rem] text-alert">
      {message}
    </p>
  ) : null
}
