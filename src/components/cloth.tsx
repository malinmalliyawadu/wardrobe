import type { CSSProperties } from 'react'

/**
 * One flat swatch of a colour, any size. Decorative unless given a label.
 * Its name (the label, else `name`) shows under the mouse (colour-tip.tsx).
 */
export function Swatch({
  colour,
  className = '',
  struck = false,
  label,
  name,
}: {
  colour: string
  className?: string
  struck?: boolean
  label?: string
  name?: string | null
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-colour={label ?? name ?? undefined}
      className={`swatch block rounded-[var(--radius-tile)] ${struck ? 'swatch-struck' : ''} ${className}`}
      style={{ '--swatch': colour } as CSSProperties}
    />
  )
}

/**
 * A slot's colours: up to three chips side by side in one small block, so a
 * row of slots reads as a row of colour. Static: seen on every row of the
 * blueprint, so it never animates. Each chip is named under the mouse.
 */
export function SlotSwatches({ colours, names, className = 'h-11 w-11' }: { colours: string[]; names: (string | null)[]; className?: string }) {
  const shown = colours.slice(0, 3)
  const label = shown.length
    ? shown.map((colour, index) => names[index] ?? colour).join(', ')
    : 'No colour set'
  if (shown.length === 0) {
    return (
      <span role="img" aria-label={label} className={`block shrink-0 rounded-[var(--radius-tile)] border border-dashed border-line ${className}`} />
    )
  }
  return (
    <span role="img" aria-label={label} className={`flex shrink-0 gap-px overflow-hidden rounded-[var(--radius-tile)] ${className}`}>
      {shown.map((colour, index) => (
        <span
          key={`${index}-${colour}`}
          data-colour={names[index] ?? undefined}
          className="swatch block h-full min-w-0 flex-1"
          style={{ '--swatch': colour } as CSSProperties}
        />
      ))}
    </span>
  )
}
