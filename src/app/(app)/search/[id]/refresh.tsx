'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const EVERY_MS = 2500

/**
 * Re-renders the page from the server every few seconds while the search
 * runs, so its progress and then its results arrive without a tap. Rendered
 * only while the search is running; once the page renders it done, this is
 * gone and the asking stops. A page hidden by <Activity> runs no effects.
 */
export function Refresh() {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), EVERY_MS)
    return () => clearInterval(timer)
  }, [router])
  return null
}
