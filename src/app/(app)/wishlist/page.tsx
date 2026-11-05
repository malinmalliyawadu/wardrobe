import type { Metadata } from 'next'
import { Suspense } from 'react'

import { Wishlist, WishlistSkeleton } from '@/components/feed/wishlist'

export const metadata: Metadata = { title: 'Wishlist' }

/**
 * What he wants: every find he saved, and any product he pasted a link for,
 * each checked every night for a lower price and his size. Its own tab,
 * since he opens it in the shops to decide whether to buy.
 */
export default function WishlistPage() {
  return (
    <Suspense fallback={<WishlistSkeleton />}>
      <Wishlist />
    </Suspense>
  )
}
