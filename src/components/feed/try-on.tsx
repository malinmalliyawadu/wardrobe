'use client'

import { seeItOnMe, seeStatementOutfitOnMe } from '@/app/try-on-actions'
import { PieceImage } from '@/components/piece-image'
import { TryOn } from '@/components/try-on'
import type { FindCard as Find } from '@/lib/feed'
import type { WornWith } from '@/lib/statements'
import type { OnMe } from '@/lib/try-on'

import { PriceLine } from './product'
import { ProductPhoto } from './product-photo'

/** "See it on me" on a find: him in it, beside the shop's own photo. */
export function SeeItOnMe({ find }: { find: Find }) {
  return (
    <TryOn
      initial={find.on_me}
      start={(again) => seeItOnMe(find.product_id, again)}
      content={{
        eyebrow: find.retailer,
        title: find.title,
        alt: `You wearing the ${find.title}`,
        aside: (
          <>
            <ShopPhoto find={find} />
            <div className="mt-4">
              <PriceLine find={find} />
            </div>
          </>
        ),
        note: 'Made by OpenAI from your full-length photo. Judge the colour against the shop’s photo, and the cut by the size guide: the picture cannot know how this size sits on you.',
        actions: <ShopLink find={find} />,
      }}
    />
  )
}

/**
 * A statement piece on him with the pieces of his it wears with, as its card
 * names them: the outfit it was chosen to lead. What else he has on in his
 * photo stays as it is.
 */
export function SeeOutfitOnMe({ find, pieces, initial }: { find: Find; pieces: WornWith[]; initial: OnMe | null }) {
  const names = pieces.map((piece) => piece.name)
  const withYour = `${names.slice(0, -1).join(', ')}${names.length > 1 ? ' and ' : ''}${names.at(-1)}`
  return (
    <TryOn
      label="See the outfit on me"
      initial={initial}
      start={(again) =>
        seeStatementOutfitOnMe(
          find.product_id,
          pieces.map((piece) => piece.id),
          again,
        )
      }
      content={{
        eyebrow: find.retailer,
        title: find.title,
        alt: `You wearing the ${find.title} with your ${withYour}`,
        aside: (
          <>
            <ShopPhoto find={find} />
            <div className="mt-4">
              <PriceLine find={find} />
            </div>
            <p className="caption mt-5">With your</p>
            <ul className="mt-2 grid gap-2">
              {pieces.map((piece) => (
                <li key={piece.id} className="flex items-center gap-3">
                  <PieceImage piece={piece} sizes="2.5rem" className="aspect-[3/4] w-10 shrink-0 rounded-[var(--radius-tile)]" />
                  <span className="min-w-0 text-[0.9375rem] leading-snug">{piece.name}</span>
                </li>
              ))}
            </ul>
          </>
        ),
        note: 'Made by OpenAI from your full-length photo, the shop’s photo and your pieces. Judge the colour against the shop’s photo, and the cut by the size guide: the picture cannot know how this size sits on you.',
        actions: <ShopLink find={find} />,
      }}
    />
  )
}

function ShopPhoto({ find }: { find: Find }) {
  return (
    <figure>
      <ProductPhoto find={find} sizes="(min-width: 1024px) 24rem, 50vw" className="aspect-[4/5] w-1/2 rounded-[var(--radius-tile)] lg:w-full" />
      <figcaption className="caption mt-2">The shop’s photo</figcaption>
    </figure>
  )
}

function ShopLink({ find }: { find: Find }) {
  return (
    <a href={find.url} target="_blank" rel="noopener noreferrer" className="text-button">
      Open the shop
    </a>
  )
}
