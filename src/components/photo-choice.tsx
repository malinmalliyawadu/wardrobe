'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, useTransition } from 'react'

import { addOwnPhoto, choosePhoto } from '@/app/feed-actions'
import type { ProductImage } from '@/lib/finder/shopify'

import { productLoader } from './feed/product-photo'
import { Spinner } from './form'

/*
 * The photo a product shows, chosen from a row of the shop's photos, or his
 * own added at the end (src/lib/product-photos.ts). A tap chooses at once and
 * the server follows; a choice it refuses goes back to the one before. Used
 * where a link is pasted (the wishlist and a piece from a shop link) and on a
 * wishlist row.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'

export function PhotoChoice({
  productId,
  photos,
  shown,
  bleed = false,
  label = 'The photo it shows',
}: {
  productId: number
  photos: ProductImage[]
  shown: string | null
  /** Runs the row out to the screen's edge on the phone, where it sits in the page's own column. */
  bleed?: boolean
  label?: string
}) {
  const [selected, setSelected] = useState(shown)
  const [own, setOwn] = useState<ProductImage[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [uploading, startUpload] = useTransition()
  const [, startChoice] = useTransition()
  // Only the latest tap may undo itself, so a slow answer to an earlier one never wins.
  const latest = useRef(0)
  const rowRef = useRef<HTMLDivElement>(null)

  // The photo it shows may be far along a row that scrolls, so the row opens on it.
  useEffect(() => {
    const row = rowRef.current
    const active = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !active || row.scrollWidth <= row.clientWidth) return
    row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2
  }, [])

  const row = [...photos, ...own.filter((photo) => !photos.some((shop) => shop.src === photo.src))]

  function choose(src: string) {
    if (src === selected) return
    const before = selected
    const tap = ++latest.current
    setSelected(src)
    setMessage(null)
    startChoice(async () => {
      const result = await choosePhoto({ product_id: productId, src })
      if (!result.ok && tap === latest.current) {
        setSelected(before)
        setMessage(result.message)
      }
    })
  }

  function upload(file: File) {
    const form = new FormData()
    form.set('product_id', String(productId))
    form.set('file', file)
    setMessage(null)
    const tap = ++latest.current
    startUpload(async () => {
      const result = await addOwnPhoto(form)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setOwn((current) => [...current.filter((photo) => photo.src !== result.shown.src), result.shown])
      if (tap === latest.current) setSelected(result.shown.src)
    })
  }

  return (
    <div>
      <div
        ref={rowRef}
        role="group"
        aria-label={label}
        className={
          bleed
            ? 'scroller bleed relative gap-2 py-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0'
            : 'relative -m-1 flex gap-2 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        }
      >
        {row.map((photo, index) => {
          const isOwn = photo.src.startsWith('/photos/finds/')
          const active = photo.src === selected
          return (
            <button
              key={photo.src}
              type="button"
              aria-pressed={active}
              aria-label={isOwn ? 'Your photo' : `The shop’s photo ${index + 1} of ${photos.length}`}
              onClick={() => choose(photo.src)}
              className={`photo pressable relative aspect-[4/5] w-[4.5rem] shrink-0 overflow-hidden rounded-[var(--radius-tile)] ${active ? 'outline-2 outline-offset-2 outline-accent' : ''} ${own.includes(photo) ? 'tile-enter' : ''}`}
            >
              <Image loader={productLoader} src={photo.src} alt="" fill sizes="4.5rem" className="object-contain" />
            </button>
          )
        })}
        <label
          className={`pressable relative flex aspect-[4/5] w-[4.5rem] shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-tile)] border border-dashed border-line px-1 text-center text-[0.75rem] leading-tight text-ink-2 ${uploading ? 'cursor-progress' : ''}`}
        >
          <input
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={uploading}
            aria-label="Add your own photo"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) upload(file)
              event.target.value = ''
            }}
          />
          {uploading ? (
            <>
              <Spinner />
              <span>Adding</span>
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Your own</span>
            </>
          )}
        </label>
      </div>
      {message ? (
        <p role="alert" className="mt-2 text-sm text-alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}
