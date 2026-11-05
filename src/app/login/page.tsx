import type { Metadata } from 'next'
import { Suspense } from 'react'

import { safeNext } from '@/lib/auth'

import { SignInForm } from './form'

export const metadata: Metadata = { title: 'Sign in' }

/**
 * The one page a stranger can reach, so it says nothing about Malin: no
 * nav, no palette, no profile. The shell prerenders; only where to go after
 * signing in comes from the request.
 */
export default function SignInPage({ searchParams }: PageProps<'/login'>) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-[var(--gutter)] pt-[env(safe-area-inset-top)] pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <p className="display text-[3rem]">Wardrobe</p>
      <h1 className="mt-4 text-[1.0625rem] leading-normal text-ink-2">A stylist for one. Sign in to carry on.</h1>
      <Suspense fallback={<SignInForm next="/" />}>
        <WithNext searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

async function WithNext({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const { next } = await searchParams
  return <SignInForm next={safeNext(typeof next === 'string' ? next : null)} />
}
