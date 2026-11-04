import type { CSSProperties } from 'react'

/** One fabric swatch, any size. Decorative unless given a label. */
export function Cloth({
  colour,
  className = '',
  struck = false,
  label,
}: {
  colour: string
  className?: string
  struck?: boolean
  label?: string
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`cloth block ${struck ? 'cloth-struck' : ''} ${className}`}
      style={{ '--swatch': colour } as CSSProperties}
    />
  )
}

const FAN = [[0], [-7, 7], [-12, 0, 12]] as const

/**
 * A slot's colours as a small fan of swatches, the Today fan in miniature.
 * Static: it is seen on every row of the blueprint, so it never animates.
 */
export function SlotSwatches({ colours, names }: { colours: string[]; names: (string | null)[] }) {
  const shown = colours.slice(0, 3)
  const label = shown.length
    ? shown.map((colour, index) => names[index] ?? colour).join(', ')
    : 'No colour set'
  if (shown.length === 0) {
    return (
      <span role="img" aria-label={label} className="relative block h-11 w-11 shrink-0">
        <span className="absolute inset-x-2.5 inset-y-0.5 rounded-[0.3rem] border border-dashed border-line" />
      </span>
    )
  }
  const angles = FAN[shown.length - 1] ?? FAN[0]
  return (
    <span role="img" aria-label={label} className="relative block h-11 w-11 shrink-0">
      {shown.map((colour, index) => (
        <span
          key={`${index}-${colour}`}
          className="cloth absolute inset-x-2.5 inset-y-0.5 rounded-[0.3rem]"
          style={
            {
              '--swatch': colour,
              transform: `rotate(${angles[index] ?? 0}deg)`,
              transformOrigin: '50% 115%',
              zIndex: index,
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}
