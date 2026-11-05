import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps): IconProps {
  return {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  }
}

/** The sun over a horizon: today. */
export function TodayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 16.5a6.5 6.5 0 0 1 13 0" />
      <path d="M3 20.5h18" />
      <path d="M12 5.5V3.5" />
      <path d="m6 8.5-1.4-1.4" />
      <path d="m18 8.5 1.4-1.4" />
    </svg>
  )
}

/** A swing tag: what the shops have. */
export function FindsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12.6 3.5H19a1.5 1.5 0 0 1 1.5 1.5v6.4a1.5 1.5 0 0 1-.44 1.06l-8.5 8.5a1.5 1.5 0 0 1-2.12 0l-6.4-6.4a1.5 1.5 0 0 1 0-2.12l8.5-8.5a1.5 1.5 0 0 1 1.06-.44Z" />
      <circle cx="16" cy="8" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** A bookmark: the wishlist. */
export function WishlistIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2L5.5 20.5v-16a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

/** A coat hanger: what he owns. */
export function WardrobeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5a2.1 2.1 0 0 1 2.1 2.1c0 1.25-1.05 1.7-2.1 2.4v1.5" />
      <path d="M12 9.5 3.9 15.3A1.55 1.55 0 0 0 4.8 18.1h14.4a1.55 1.55 0 0 0 .9-2.8L12 9.5Z" />
    </svg>
  )
}

/** Slots of different sizes: the blueprint. */
export function BlueprintIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1" />
    </svg>
  )
}

/** Head and shoulders: you. */
export function PersonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="7.5" r="3.6" />
      <path d="M4.5 20.5c.8-4 3.7-6.5 7.5-6.5s6.7 2.5 7.5 6.5" />
    </svg>
  )
}

/** A lens: search the shops for something. */
export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="m15.2 15.2 5.3 5.3" />
    </svg>
  )
}

/** The small chevron that says a row leads somewhere. */
export function ChevronIcon(props: IconProps) {
  return (
    <svg {...base({ width: 18, height: 18, ...props })}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

export function BackIcon(props: IconProps) {
  return (
    <svg {...base({ width: 18, height: 18, ...props })}>
      <path d="m15 5-7 7 7 7" />
    </svg>
  )
}

export function TickIcon(props: IconProps) {
  return (
    <svg {...base({ width: 15, height: 15, strokeWidth: 2.25, ...props })}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base({ width: 18, height: 18, strokeWidth: 2, ...props })}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function CrossIcon(props: IconProps) {
  return (
    <svg {...base({ width: 18, height: 18, strokeWidth: 2, ...props })}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}
