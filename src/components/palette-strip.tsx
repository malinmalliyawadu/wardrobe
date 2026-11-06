import Link from 'next/link'
import type { CSSProperties } from 'react'

/*
 * The app's signature: his five best colours as a row of flat chips beside
 * the wordmark, on every page. Undyed calico until there is a guide, the
 * season's colours once the read is confirmed, his own once the guide is
 * drafted. Tapping it opens the guide; each chip is named under the mouse.
 */

export type StripColour = { hex: string; name?: string }

export const BLANK_STRIP: StripColour[] = ['#dcd6c8', '#c9c2b4', '#b0a99b', '#8f887c', '#6a655d'].map((hex) => ({ hex }))

export function PaletteStrip({
  colours,
  label = 'Your palette',
  size = 'small',
}: {
  colours: StripColour[] | null
  label?: string
  size?: 'small' | 'large'
}) {
  const shown = (colours ?? BLANK_STRIP).slice(0, 5)
  const names = shown.flatMap((colour) => (colour.name ? [colour.name] : []))
  const text = colours ? (names.length ? `${label}: ${names.join(', ')}` : label) : 'No palette yet'
  const chip = size === 'large' ? 'h-14 w-7' : 'h-7 w-3.5'
  return (
    <Link href="/blueprint/guide" aria-label={text} className="pressable inline-flex gap-0.5 rounded-[var(--radius-tile)]">
      {shown.map((colour, index) => (
        <span
          key={`${index}-${colour.hex}`}
          data-colour={colour.name}
          className={`swatch block rounded-[2px] ${chip}`}
          style={{ '--swatch': colour.hex } as CSSProperties}
        />
      ))}
    </Link>
  )
}
