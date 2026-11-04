'use client'

import { seeItOnMe } from '@/app/try-on-actions'
import { TryOn } from '@/components/try-on'
import type { FindCard as Find } from '@/lib/feed'

import { PriceLine } from './product'
import { ProductPhoto } from './product-photo'

/** "See it on me" on a find: him in it, beside the shop's own photo. */
export function SeeItOnMe({ find }: { find: Find }) {
  return (
    <TryOn
      initial={find.on_me}
      start={() => seeItOnMe(find.product_id)}
      content={{
        eyebrow: find.retailer,
        title: find.title,
        alt: `You wearing the ${find.title}`,
        aside: (
          <>
            <figure>
              <ProductPhoto find={find} sizes="(min-width: 1024px) 24rem, 50vw" className="aspect-[4/5] w-1/2 rounded-xl lg:w-full" />
              <figcaption className="mt-2 text-[0.8125rem] text-ink-3">The shop’s photo</figcaption>
            </figure>
            <div className="mt-4">
              <PriceLine find={find} />
            </div>
          </>
        ),
        note: 'Made by OpenAI from your full-length photo. Judge the colour against the shop’s photo, and the cut by the size guide: the picture cannot know how this size sits on you.',
        actions: (
          <a href={find.url} target="_blank" rel="noopener noreferrer" className="text-button">
            Open the shop
          </a>
        ),
      }}
    />
  )
}
