import type { CSSProperties } from 'react'

/*
 * Undyed cloth: calico through charcoal. These stand in until the profile
 * exists, when the fan shows Malin's own palette instead.
 */
const swatches = ['#d9d2c5', '#bfb8ad', '#a39d93', '#857f76', '#5e5a54']
const angles = [-26, -13, 0, 13, 26]

export function SwatchFan() {
  return (
    <div className="relative h-28 w-48" role="img" aria-label="Five blank fabric swatches fanned out">
      {swatches.map((colour, index) => (
        <span
          key={colour}
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
