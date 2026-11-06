import { connection } from 'next/server'

import { PageTitle } from '@/components/section'
import { Bone, Skeleton, TextBone } from '@/components/skeleton'
import { db } from '@/lib/db'
import { getWishlist } from '@/lib/feed'
import { listRetailers, readable, type Retailer } from '@/lib/retailers'

import { AddLink, type ManualStore } from './add-link'
import { SavedRow } from './find-card'
import { changeLine, newsSummary } from './saved-change'

/**
 * The wishlist: the line to paste a product link first, since that is what
 * he comes here to do from a shop, then everything saved, newest news
 * first, in two columns on the laptop.
 */
export async function Wishlist() {
  await connection()
  const [list, retailers] = await Promise.all([getWishlist(), listRetailers(db())])
  const now = new Date()
  const news = newsSummary(list.saved, list.run?.started_at ?? null, now)
  const count = list.saved.length
  const forSlots = list.saved.filter((find) => find.slot_id !== null).length
  const line =
    count === 0
      ? 'Nothing saved yet.'
      : `${count} ${count === 1 ? 'piece' : 'pieces'}${forSlots ? `, ${forSlots} for ${forSlots === 1 ? 'a slot' : 'slots'}` : ''}, each checked every night for a lower price and your size.`

  return (
    <section aria-labelledby="wishlist">
      <PageTitle title={<span id="wishlist">Wishlist</span>} line={news ? <span className="text-accent">{news}</span> : line} />
      {news ? <p className="mt-1 text-[0.9375rem] text-ink-2">{line}</p> : null}

      <div className="max-w-2xl">
        <AddLink slots={list.openSlots} manualStores={manualStores(retailers)} />
      </div>

      {count > 0 ? (
        <ul className="mt-10 divide-y divide-line lg:grid lg:grid-cols-2 lg:gap-x-12 lg:divide-y-0">
          {list.saved.map((find) => (
            <SavedRow
              key={find.product_id}
              find={find}
              slotName={find.slot_id === null ? null : (list.slotNames[find.slot_id] ?? null)}
              change={changeLine(find, now)}
            />
          ))}
        </ul>
      ) : (
        <p className="prose mt-10 max-w-[44ch] text-[0.9375rem] text-ink-2">
          Save a find, or paste a link to anything you want from the shops, and it lands here. Every night it is
          checked for a lower price, and for your size coming back in stock.
        </p>
      )}
    </section>
  )
}

/** The shops whose links open the by-hand fields, with the hosts a link from each is on. */
function manualStores(retailers: Retailer[]): ManualStore[] {
  return retailers
    .filter((retailer) => !readable(retailer))
    .map((retailer) => ({
      name: retailer.name,
      currency: retailer.currency,
      hosts: [retailer.base_url, retailer.feed_url]
        .filter((origin): origin is string => Boolean(origin))
        .map((origin) => new URL(origin).host.toLowerCase().replace(/^www\./, '')),
    }))
}

export function WishlistSkeleton() {
  return (
    <Skeleton label="Loading your wishlist">
      <span className="flex h-[2.4rem] items-center text-[2.5rem] sm:h-[3.1rem] sm:text-[3.25rem]">
        <Bone className="h-[0.7em] w-40 rounded-[2px]" />
      </span>
      <div className="mt-3 text-[1.0625rem]">
        <TextBone className="w-80 max-w-full" />
      </div>
      <div className="mt-6 max-w-2xl">
        <Bone className="mb-2 h-3.5 w-36 rounded-[2px]" />
        <Bone className="h-12 rounded-[var(--radius-control)]" />
      </div>
      <div className="mt-10 divide-y divide-line lg:grid lg:grid-cols-2 lg:gap-x-12 lg:divide-y-0">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex gap-4 py-4 lg:border-b lg:border-line">
            <Bone className="aspect-[4/5] w-22 shrink-0" />
            <div className="min-w-0 flex-1 text-[0.9375rem]">
              <TextBone className="w-24" size="text-[0.8125rem]" />
              <TextBone className="w-11/12" />
              <TextBone className="w-14" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
