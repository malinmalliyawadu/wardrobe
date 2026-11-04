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
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 pt-[env(safe-area-inset-top)] pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <p className="font-display text-[3rem] leading-none italic tracking-[-0.02em]">Wardrobe</p>
      <div className="mt-6 h-px w-12 bg-brass" aria-hidden />
      <h1 className="mt-6 text-[1.0625rem] leading-relaxed text-ink-2">A stylist for one. Sign in to carry on.</h1>
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
