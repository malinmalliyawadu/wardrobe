import { Suspense } from 'react'

import { Nav, NavShell, Wordmark } from '@/components/nav'

/** The three tabs and their frame. The sign-in page sits outside it, with no nav to show. */
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[13rem_minmax(0,1fr)]">
      <Suspense fallback={<NavShell />}>
        <Nav />
      </Suspense>
      <div className="min-w-0">
        <header className="px-5 pt-[calc(1rem+env(safe-area-inset-top))] lg:hidden">
          <Wordmark />
        </header>
        <main className="mx-auto w-full max-w-2xl px-5 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-12 lg:pt-16 lg:pb-20">
          {children}
        </main>
      </div>
    </div>
  )
}
