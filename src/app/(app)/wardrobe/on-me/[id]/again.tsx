'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { makeItAgain } from '@/app/try-on-actions'
import { Spinner } from '@/components/form'

/** "Make it again": a new picture of the same thing, which then shows on the On me page in the making. */
export function MakeAgain({ id }: { id: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div aria-live="polite">
      <button
        type="button"
        className="text-button text-ink-2"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await makeItAgain(id)
            if (result.ok) router.push('/wardrobe/on-me')
            else setError(result.message)
          })
        }}
      >
        {pending ? <Spinner /> : null}
        Make it again
      </button>
      {error ? <p className="px-2 text-[0.8125rem] leading-snug text-alert">{error}</p> : null}
    </div>
  )
}
