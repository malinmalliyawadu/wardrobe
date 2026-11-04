import type { CSSProperties } from 'react'

export type FanSwatch = { hex: string; name?: string }

/*
 * Undyed cloth, calico through charcoal, until the profile exists. Then the
 * five representative colours of Malin's season, and once the style guide
 * exists, the first five of his own best colours. Those have names, shown
 * under the fan while the pointer rests on a swatch.
 */
export const BLANK_SWATCHES: FanSwatch[] = ['#d9d2c5', '#bfb8ad', '#a39d93', '#857f76', '#5e5a54'].map((hex) => ({ hex }))
const angles = [-26, -13, 0, 13, 26]

export function SwatchFan({
  colours = BLANK_SWATCHES,
  label = 'Five blank fabric swatches fanned out',
}: {
  colours?: FanSwatch[]
  label?: string
}) {
  const shown = colours.slice(0, 5)
  const names = shown.flatMap((colour) => (colour.name ? [colour.name] : []))
  return (
    <div className="relative h-28 w-48" role="img" aria-label={names.length ? `${label}: ${names.join(', ')}` : label}>
      {shown.map((colour, index) => (
        <span
          key={`${index}-${colour.hex}`}
          className="swatch"
          style={
            {
              '--swatch': colour.hex,
              '--r': `${angles[index]}deg`,
              '--d': `${index * 60}ms`,
              zIndex: index,
            } as CSSProperties
          }
        >
          {colour.name ? <span className="swatch-tip">{colour.name}</span> : null}
        </span>
      ))}
    </div>
  )
}
