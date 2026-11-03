import Link from 'next/link'
import type { ComponentProps } from 'react'

type Props = ComponentProps<typeof Link> & {
  variant?: 'primary' | 'quiet'
}

export function ButtonLink({ variant = 'primary', className = '', children, ...rest }: Props) {
  const look =
    variant === 'primary'
      ? 'btn-primary'
      : 'border border-line text-ink transition-colors duration-150 ease-out'
  return (
    <Link
      {...rest}
      className={`pressable inline-flex h-12 items-center justify-center rounded-full px-6 text-base font-medium ${look} ${className}`}
    >
      {children}
    </Link>
  )
}
