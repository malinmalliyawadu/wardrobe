'use client'

import { useState } from 'react'

import type { GarmentType } from '@/lib/wardrobe-values'

import { AddLink, type ManualStore } from './add-link'
import { AddPhoto } from './add-photo'

type Mode = 'link' | 'photo'

const MODES: { value: Mode; label: string }[] = [
  { value: 'link', label: 'Shop link' },
  { value: 'photo', label: 'Photo' },
]

/**
 * Two ways onto the wishlist: a link from one of the shops, which is read and
 * checked every night, or a photo of something seen anywhere, which Claude
 * reads once. A link first, since that is what he comes here with from a shop.
 */
export function AddWish({
  slots,
  manualStores,
}: {
  slots: { id: number; name: string; garment_type: GarmentType }[]
  manualStores: ManualStore[]
}) {
  const [mode, setMode] = useState<Mode>('link')
  return (
    <div className="mt-6">
      <p id="add-wish" className="mb-2 text-sm font-medium text-ink-2">
        Add something you want
      </p>
      <div role="group" aria-labelledby="add-wish" className="flex flex-wrap gap-2">
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={mode === item.value}
            onClick={() => setMode(item.value)}
            className="segment pressable"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {mode === 'link' ? <AddLink slots={slots} manualStores={manualStores} /> : <AddPhoto slots={slots} />}
      </div>
    </div>
  )
}
