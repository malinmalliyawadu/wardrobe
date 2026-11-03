import type { CSSProperties } from 'react'

/*
 * Undyed cloth, calico through charcoal, until the profile exists. After
 * that the fan shows the five strongest colours of Malin's season.
 */
export const BLANK_SWATCHES = ['#d9d2c5', '#bfb8ad', '#a39d93', '#857f76', '#5e5a54']
const angles = [-26, -13, 0, 13, 26]

export function SwatchFan({
  colours = BLANK_SWATCHES,
  label = 'Five blank fabric swatches fanned out',
}: {
  colours?: string[]
  label?: string
}) {
  return (
    <div className="relative h-28 w-48" role="img" aria-label={label}>
      {colours.slice(0, 5).map((colour, index) => (
        <span
          key={`${index}-${colour}`}
          className="swatch"
          style={
            {
              '--swatch': colour,
              '--r': `${angles[index]}deg`,
              '--d': `${index * 60}ms`,
              zIndex: index,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
