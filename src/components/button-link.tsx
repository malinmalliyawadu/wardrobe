import Link from 'next/link'
import type { ComponentProps } from 'react'

type Props = ComponentProps<typeof Link> & {
  variant?: 'primary' | 'quiet'
  size?: 'normal' | 'small'
}

export function ButtonLink({ variant = 'primary', size = 'normal', className = '', children, ...rest }: Props) {
  return (
    <Link
      {...rest}
      className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-quiet'} ${size === 'small' ? 'btn-small' : ''} ${className}`}
    >
      {children}
    </Link>
  )
}
