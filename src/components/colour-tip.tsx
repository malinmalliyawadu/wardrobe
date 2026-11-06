'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/*
 * Names a colour under the mouse. Any element that carries `data-colour`
 * (a swatch, a slot's chip, the palette strip, a piece's cloth) gets its name
 * in a small ink label above it, so none of them needs to be a client
 * component and a chip inside an `overflow: hidden` block is still named in
 * full. Over a chip the label sits centred above the chip; over a swatch the
 * size of a picture it sits above the pointer, so it stays where he is
 * looking. Laptop only: a phone has no hover, and each swatch's name is in
 * its label for a screen reader either way.
 */

type Tip = { name: string; x: number; top: number; bottom: number }

/** Space kept between the label and what it names, and the window's edge. */
const GAP = 8
/** A swatch wider or taller than this is a picture, and the label follows the pointer. */
const CHIP = 96
/** Clear of the cursor's arrow, below the pointer. */
const CURSOR = 20

function tipAt(event: PointerEvent): Tip | null {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-colour]') : null
  const name = target?.dataset.colour
  if (!target || !name) return null
  const box = target.getBoundingClientRect()
  if (box.width <= CHIP && box.height <= CHIP) return { name, x: box.left + box.width / 2, top: box.top, bottom: box.bottom }
  return { name, x: event.clientX, top: event.clientY, bottom: event.clientY + CURSOR }
}

function same(a: Tip | null, b: Tip | null): boolean {
  return a === b || (!!a && !!b && a.name === b.name && a.x === b.x && a.top === b.top && a.bottom === b.bottom)
}

export function ColourTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
    function move(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || !fine.matches) return
      const next = tipAt(event)
      setTip((current) => (same(current, next) ? current : next))
    }
    function hide() {
      setTip(null)
    }
    function out(event: PointerEvent) {
      if (!event.relatedTarget) hide()
    }
    document.addEventListener('pointerover', move)
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerout', out)
    document.addEventListener('pointerdown', hide)
    window.addEventListener('scroll', hide, { capture: true, passive: true })
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerover', move)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('pointerdown', hide)
      window.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Placed once its width is known, before it paints: centred on the anchor,
  // kept inside the window, and below when there is no room above.
  useLayoutEffect(() => {
    const label = ref.current
    if (!label || !tip) return
    const { width, height } = label.getBoundingClientRect()
    const left = Math.min(Math.max(tip.x - width / 2, GAP), window.innerWidth - width - GAP)
    const above = tip.top - height - GAP
    label.style.left = `${left}px`
    label.style.top = `${above >= GAP ? above : tip.bottom + GAP}px`
  }, [tip])

  if (!tip) return null
  return (
    <div ref={ref} aria-hidden className="colour-tip">
      {tip.name}
    </div>
  )
}
