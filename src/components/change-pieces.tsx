'use client'

import { useId, useState, useTransition, type FormEvent } from 'react'

import { remakeLook } from '@/app/(app)/wardrobe/actions'
import { PieceImage } from '@/components/piece-image'
import { Refresh } from '@/components/refresh'
import { REMAKE_NOTE_MAX, wholeWithout } from '@/lib/look-rules'
import type { Look } from '@/lib/looks'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

/*
 * Changing a look's pieces, in place of its list of pieces on the card: each
 * piece with Swap (for another of his, Opus's pick) and Remove (gone, nothing
 * in its place), a line for what he wants, and "Remake the look". Remove is
 * off for a piece the look cannot stand without (its trousers, its shoes, its
 * only top); those swap. Opus takes ten to thirty seconds; the card waits, and
 * the remade look takes this one's place when it is in. Opened from another
 * tab while a remake is still being made, it shows that one and asks the
 * server again until it is done.
 */

type Mark = 'swap' | 'remove'

export function ChangePieces({ look, onClose }: { look: Look; onClose: () => void }) {
  const [marks, setMarks] = useState<Map<number, Mark>>(() => {
    const from = look.remaking
    return new Map<number, Mark>([
      ...(from?.swap ?? []).map((id) => [id, 'swap'] as const),
      ...(from?.remove ?? []).map((id) => [id, 'remove'] as const),
    ])
  })
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const noteId = useId()
  const busy = pending || look.remaking !== null

  const removed = new Set([...marks].filter(([, mark]) => mark === 'remove').map(([id]) => id))
  /** Whether this piece can go with nothing in its place, given what else is removed. */
  const canRemove = (id: number) => removed.has(id) || wholeWithout(look.pieces, new Set([...removed, id]))
  const locked = look.pieces.some((piece) => !canRemove(piece.id))

  function toggle(id: number, mark: Mark) {
    setError(null)
    setMarks((current) => {
      const next = new Map(current)
      if (next.get(id) === mark) next.delete(id)
      else next.set(id, mark)
      return next
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (marks.size === 0 || busy) return
    setError(null)
    const ask = {
      look_id: look.id,
      swap: [...marks].filter(([, mark]) => mark === 'swap').map(([id]) => id),
      remove: [...removed],
      note: note.trim() || null,
    }
    startTransition(async () => {
      const result = await remakeLook(ask)
      // On success the page comes back with the remade look in this one's place.
      if (!result.ok) setError(result.message)
    })
  }

  return (
    // A container, so a narrow card puts the buttons under the piece's name and a wide one beside it.
    <form onSubmit={submit} className="tray @container mt-4" aria-label={`Change the pieces of ${look.title}`}>
      <ul className="divide-y divide-line">
        {look.pieces.map((piece) => {
          const mark = marks.get(piece.id)
          return (
            <li key={piece.id} className="flex items-start gap-3 py-2.5 @[24rem]:items-center">
              <PieceImage
                piece={piece}
                sizes="3rem"
                className={`h-14 w-11 shrink-0 rounded-[var(--radius-tile)] transition-opacity duration-150 ${mark ? 'opacity-40' : ''}`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2 @[24rem]:flex-row @[24rem]:items-center @[24rem]:justify-between @[24rem]:gap-3">
                <span className="min-w-0 leading-snug">
                  <span className={`block text-[0.9375rem] ${mark === 'remove' ? 'text-ink-3 line-through decoration-ink-3' : 'text-ink'}`}>
                    {piece.name}
                  </span>
                  <span className="caption mt-0.5 block">
                    {mark === 'swap' ? 'For another of yours' : mark === 'remove' ? 'Removed' : GARMENT_LABELS[piece.garment_type]}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    aria-pressed={mark === 'swap'}
                    disabled={busy}
                    className="segment px-3 disabled:opacity-60"
                    onClick={() => toggle(piece.id, 'swap')}
                  >
                    Swap
                  </button>
                  <button
                    type="button"
                    aria-pressed={mark === 'remove'}
                    disabled={busy || !canRemove(piece.id)}
                    className="segment px-3 disabled:opacity-40"
                    onClick={() => toggle(piece.id, 'remove')}
                  >
                    Remove
                  </button>
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      {locked ? (
        <p className="mt-1 text-[0.8125rem] leading-normal text-ink-3">
          A look needs a top, trousers and shoes, so those can be swapped but not removed.
        </p>
      ) : null}

      <label htmlFor={noteId} className="mt-4 mb-1.5 block text-sm font-medium text-ink-2">
        Anything in particular?
      </label>
      <input
        id={noteId}
        type="text"
        value={note}
        maxLength={REMAKE_NOTE_MAX}
        disabled={busy}
        placeholder="Lighter shoes, nothing black"
        onChange={(event) => setNote(event.target.value)}
        className="field"
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={marks.size === 0 || busy} className="btn btn-quiet btn-small">
          {busy ? 'Remaking' : 'Remake the look'}
        </button>
        {busy ? null : (
          <button type="button" className="text-button text-ink-2" onClick={onClose}>
            Keep it
          </button>
        )}
      </div>
      {busy ? (
        <p role="status" className="mt-2 text-[0.8125rem] leading-normal text-ink-3">
          Opus is remaking it around the pieces you kept. Under half a minute.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] leading-normal text-alert">
          {error}
        </p>
      ) : null}
      {look.remaking && !pending ? <Refresh /> : null}
    </form>
  )
}
