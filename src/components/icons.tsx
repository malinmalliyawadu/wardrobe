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

/** A coat hanger: today's finds. */
export function HangerIcon(props: IconProps) {
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
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.6" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.6" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.6" />
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

/** A shirt laid flat: looks from what he owns. */
export function ShirtIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8.6 3.8 4.2 6.1a1.4 1.4 0 0 0-.7.9l-.9 3.4 3.3 1.1V19a1.5 1.5 0 0 0 1.5 1.5h9.2A1.5 1.5 0 0 0 18.1 19v-7.5l3.3-1.1-.9-3.4a1.4 1.4 0 0 0-.7-.9l-4.4-2.3" />
      <path d="M8.6 3.8c.6 1.5 1.9 2.4 3.4 2.4s2.8-.9 3.4-2.4" />
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
