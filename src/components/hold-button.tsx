'use client'

import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

const HOLD_MS = 1200

/**
 * Hold to confirm, for destructive and rare actions. The press is slow and the
 * fill is a real progress bar; release before the end and it snaps back.
 * Keyboard users get a confirm dialog instead of a timed press. Hidden inputs
 * (an id, say) go in as children of the form via `fields`.
 */
export function HoldButton({
  action,
  label,
  pendingLabel,
  fields,
}: {
  action: (form: FormData) => void | Promise<void>
  label: string
  pendingLabel: string
  fields?: ReactNode
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const timer = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const [done, setDone] = useState(false)

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (done || timer.current !== null) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A synthetic or already-released pointer; the hold still works, it just
      // cancels if the pointer leaves the button.
    }
    setHolding(true)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setDone(true)
      formRef.current?.requestSubmit()
    }, HOLD_MS)
  }

  function cancel() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    setHolding(false)
  }

  return (
    <form ref={formRef} action={action}>
      {fields}
      <button
        type="button"
        data-holding={holding}
        style={{ '--hold-ms': `${HOLD_MS}ms` } as CSSProperties}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !done) {
            event.preventDefault()
            if (window.confirm(`${label}?`)) {
              setDone(true)
              formRef.current?.requestSubmit()
            }
          }
        }}
        aria-busy={done || undefined}
        className="hold btn btn-quiet select-none"
      >
        <span className="hold-fill" aria-hidden />
        <span className={`transition-colors duration-150 ${holding || done ? 'text-on-accent' : ''}`}>
          {done ? pendingLabel : label}
        </span>
      </button>
    </form>
  )
}
