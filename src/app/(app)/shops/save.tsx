'use client'

import { useId, useState, useTransition } from 'react'

import { feedAction } from '@/app/feed-actions'

type SlotOption = { id: number; name: string }

/*
 * Save on a Shops tile. One tap opens the choice of slot, already set to the
 * one the finder matched it to or the first for the same garment; a second
 * saves it. Saved, it says so at once, and the server's next render puts the
 * save on the tile's own line. If the save fails, the choice comes back.
 */
export function SaveFromShops({
  productId,
  title,
  defaultSlotId,
  sameKind,
  others,
  again = false,
}: {
  productId: number
  title: string
  defaultSlotId: number | null
  /** Open slots for the same garment, listed first. */
  sameKind: SlotOption[]
  others: SlotOption[]
  /** He dismissed it before; saving it now overrides that. */
  again?: boolean
}) {
  const [mode, setMode] = useState<'idle' | 'choose' | 'saved'>('idle')
  const [failed, setFailed] = useState(false)
  const [slot, setSlot] = useState(defaultSlotId === null ? '' : String(defaultSlotId))
  const [, startTransition] = useTransition()
  const selectId = useId()

  function save() {
    setMode('saved')
    setFailed(false)
    startTransition(async () => {
      const result = await feedAction({ action: 'saved', product_id: productId, slot_id: slot ? Number(slot) : null })
      if (!result.ok) {
        setMode('choose')
        setFailed(true)
      }
    })
  }

  return (
    <div className="mt-auto pt-3">
      <div key={mode} className="tray">
        {mode === 'idle' ? (
          <button type="button" className="btn btn-quiet btn-small" aria-label={`Save ${title}`} onClick={() => setMode('choose')}>
            {again ? 'Save it anyway' : 'Save'}
          </button>
        ) : mode === 'choose' ? (
          <div role="group" aria-label={`Save ${title}`}>
            <label htmlFor={selectId} className="caption mb-1 block">
              For which slot
            </label>
            <select id={selectId} value={slot} onChange={(event) => setSlot(event.target.value)} className="field min-h-11">
              <option value="">Not for a slot</option>
              {sameKind.length > 0 && others.length > 0 ? (
                <>
                  <optgroup label="Same kind of piece">
                    {sameKind.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Other slots">
                    {others.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                [...sameKind, ...others].map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))
              )}
            </select>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" className="btn btn-quiet btn-small" onClick={save}>
                Save
              </button>
              <button type="button" className="text-button text-ink-3" onClick={() => setMode('idle')}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p role="status" className="flex min-h-10 items-center text-[0.9375rem] font-medium text-accent">
            Saved
          </p>
        )}
      </div>
      {failed ? <p className="mt-1 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}
    </div>
  )
}
