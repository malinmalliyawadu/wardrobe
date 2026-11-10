'use client'

import Link from 'next/link'
import { useActionState, useState, useTransition } from 'react'

import { search } from '@/app/(app)/search/actions'
import { feedAction } from '@/app/feed-actions'
import { seeAskedOutfitOnMe } from '@/app/try-on-actions'
import { PriceLine, nzd, sizeLine } from '@/components/feed/product'
import { SubmitButton } from '@/components/form'
import { TickIcon } from '@/components/icons'
import { FlatLay, type Laid } from '@/components/look-parts'
import { PieceImage, type PieceLook } from '@/components/piece-image'
import { TryOn } from '@/components/try-on'
import type { Idea, OutfitPart, OutfitView, ShopItem } from '@/lib/outfit'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

/*
 * An outfit with something from the shops in it, as a spread: everything it
 * is made of laid out on the left, and beside it the name, why it answers
 * what he asked for, and each piece as a row. A product's row opens the
 * shop's page and saves it to the wishlist; a piece of his opens the piece;
 * a garment only described is its colour as cloth, with a search of the
 * shops for it. "See it on me" puts the whole outfit on him, when every
 * piece of it has a picture.
 */

function pictured(part: OutfitPart): PieceLook {
  if (part.piece) return part.piece
  if (part.idea) return { name: part.name, colour_hex: part.idea.colour_hex, colour_name: part.idea.colour_name, photo: null, image: null }
  return { name: part.name, colour_hex: null, photo: null, image: part.product.image }
}

export function OutfitSpread({ outfit, occasion }: { outfit: OutfitView; occasion: string }) {
  const products = outfit.parts.flatMap((part) => (part.product ? [part.product] : []))
  const [saved, setSaved] = useState(() => new Set(products.filter((product) => product.state === 'saved').map((product) => product.product_id)))
  const [failed, setFailed] = useState(false)
  const [, startTransition] = useTransition()

  /** Shown at once and saved behind, one after another; a save that fails is put back. */
  function keep(ids: number[], on: boolean) {
    const before = saved
    const next = new Set(saved)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    setSaved(next)
    setFailed(false)
    startTransition(async () => {
      for (const id of ids) {
        const result = await feedAction({ action: on ? 'saved' : 'cleared', product_id: id, slot_id: null })
        if (!result.ok) {
          setSaved(before)
          setFailed(true)
          return
        }
      }
    })
  }

  const laid: Laid = {
    title: outfit.title ?? 'the outfit',
    pieces: outfit.parts.map((part) => ({ ...pictured(part), id: part.key, garment_type: part.garment_type })),
  }
  const buyable = products.filter((product) => product.state !== 'bought' && !product.gone)
  const unsaved = buyable.filter((product) => !saved.has(product.product_id))
  const described = outfit.parts.some((part) => part.idea)
  const own = outfit.parts.filter((part) => part.piece).length
  const unseen = outfit.parts.filter((part) => part.piece && !part.piece.photo && !part.piece.image).length

  return (
    <article className="lg:grid lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start lg:gap-12">
      <FlatLay look={laid} className="bleed lg:mx-0 lg:overflow-hidden lg:rounded-[var(--radius-tile)]" />

      <div className="max-w-[34rem] pt-5 lg:pt-1">
        <p className="caption">
          {occasion}
          {outfit.weather ? `, ${outfit.weather.toLowerCase()}` : ''}
        </p>
        <h3 className="display mt-1.5 text-[2.5rem] sm:text-[3.25rem]">{outfit.title}</h3>
        {outfit.why ? <p className="prose mt-5 text-[0.9375rem] leading-relaxed text-ink-2 lg:text-[1rem]">{outfit.why}</p> : null}
        {outfit.styling ? (
          <p className="prose mt-2 text-[0.9375rem] leading-snug text-ink-2 italic lg:text-[1rem]">{outfit.styling}</p>
        ) : null}

        <ul className="mt-6 divide-y divide-line border-y border-line">
          {outfit.parts.map((part) =>
            part.product ? (
              <ProductRow
                key={part.key}
                product={part.product}
                saved={saved.has(part.product.product_id)}
                onKeep={(on) => keep([part.product.product_id], on)}
              />
            ) : part.idea ? (
              <IdeaRow key={part.key} idea={part.idea} />
            ) : (
              <li key={part.key}>
                <Link href={`/wardrobe/${part.piece.id}`} className="pressable flex items-center gap-4 py-3">
                  <PieceImage
                    piece={part.piece}
                    label={GARMENT_LABELS[part.garment_type]}
                    sizes="4rem"
                    className="aspect-[4/5] w-16 shrink-0 rounded-[var(--radius-tile)]"
                  />
                  <span className="min-w-0">
                    <span className="caption block">Yours</span>
                    <span className="mt-0.5 block text-[0.9375rem] leading-snug font-medium">{part.piece.name}</span>
                  </span>
                </Link>
              </li>
            ),
          )}
        </ul>

        {buyable.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[0.9375rem] tabular-nums">
              <span className="font-medium">About {nzd(outfit.to_buy_cents)}</span>
              <span className="text-ink-2">
                {' '}
                for {buyable.length === 1 ? 'the one piece' : `the ${buyable.length} pieces`} to buy
                {own > 0 ? `, with ${own === 1 ? 'one' : own} of yours` : ''}
              </span>
            </p>
            {unsaved.length > 1 ? (
              <button type="button" className="text-button -mr-2" onClick={() => keep(unsaved.map((product) => product.product_id), true)}>
                Save all to wishlist
              </button>
            ) : null}
          </div>
        ) : null}
        {products.length > 0 ? (
          <p className="mt-1 text-[0.8125rem] text-ink-3">Prices and sizes are as the finder last read them. The shop’s page has today’s.</p>
        ) : null}
        {described ? (
          <p className="mt-4 text-[0.8125rem] text-ink-3">
            Described, not found: no shop was read for these. Search for one and the shops are judged against it, at a search’s cost.
          </p>
        ) : null}
        {failed ? <p className="mt-2 text-[0.8125rem] text-alert">That did not save. Try again.</p> : null}

        <div className="mt-4" hidden={described}>
          <TryOn
            initial={outfit.on_me}
            start={(again) => seeAskedOutfitOnMe(outfit.id, again)}
            content={{
              eyebrow: occasion,
              title: outfit.title ?? 'The outfit',
              alt: `You wearing ${(outfit.title ?? 'the outfit').toLowerCase()}`,
              aside: (
                <figure>
                  <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-tile)]">
                    {outfit.parts.map((part) => (
                      <PieceImage
                        key={part.key}
                        piece={pictured(part)}
                        label={GARMENT_LABELS[part.garment_type]}
                        sizes="(min-width: 1024px) 7rem, 30vw"
                        className="aspect-[3/4]"
                      />
                    ))}
                  </div>
                  <figcaption className="caption mt-2">What it is made from</figcaption>
                </figure>
              ),
              note: (
                <>
                  Made by OpenAI from your full-length photo{own > 0 ? ', the photos of your pieces' : ''} and the shops’ photos. Judge
                  the colours against the clothes themselves: the picture cannot know how each one sits on you.
                  {unseen > 0
                    ? ` ${unseen === 1 ? 'One piece of yours has' : `${unseen} pieces of yours have`} no photo yet, so ${unseen === 1 ? 'it was' : 'they were'} drawn from the description.`
                    : null}
                </>
              ),
            }}
          />
        </div>
      </div>
    </article>
  )
}

/** A product of the outfit: the shop's photo and page, why this one, its price in his size, and Save. */
function ProductRow({ product, saved, onKeep }: { product: ShopItem; saved: boolean; onKeep: (on: boolean) => void }) {
  return (
    <li className="flex gap-4 py-3">
      <a href={product.url} target="_blank" rel="noopener noreferrer" className="pressable block shrink-0">
        <PieceImage
          piece={{ name: product.title, colour_hex: null, photo: null, image: product.image }}
          sizes="4rem"
          className="aspect-[4/5] w-16 rounded-[var(--radius-tile)]"
        />
      </a>
      <div className="min-w-0 flex-1">
        <p className="caption truncate">{product.retailer}</p>
        <a href={product.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium">
          {product.title}
        </a>
        {product.why ? <p className="prose mt-1 text-[0.875rem] leading-snug text-ink-2">{product.why}</p> : null}
        {product.gone ? (
          <p className="mt-1 text-[0.9375rem] text-ink-3">The shop no longer lists it</p>
        ) : (
          <>
            <div className="mt-1">
              <PriceLine find={product} />
            </div>
            {product.sizes.length > 0 ? <p className="mt-0.5 text-[0.8125rem] text-ink-3">{sizeLine(product)}</p> : null}
          </>
        )}
      </div>
      <div className="shrink-0">
        {product.state === 'bought' ? (
          <p className="flex min-h-9 items-center gap-1.5 text-[0.875rem] text-ink-2">
            <TickIcon className="text-accent" />
            Bought
          </p>
        ) : product.gone ? null : (
          <button type="button" aria-pressed={saved} className="btn btn-quiet btn-small" onClick={() => onKeep(!saved)}>
            {saved ? <TickIcon className="text-accent" /> : null}
            {saved ? 'Saved' : 'Save'}
          </button>
        )}
      </div>
    </li>
  )
}

/** A garment described, not found: its colour as cloth, what it is, and a search of the shops for it. */
function IdeaRow({ idea }: { idea: Idea }) {
  const [state, action] = useActionState(search, null)
  const made = [idea.colour_name, idea.fabric, idea.fit].filter(Boolean).join(', ')
  return (
    <li className="flex gap-4 py-3">
      <PieceImage
        piece={{ name: idea.name, colour_hex: idea.colour_hex, colour_name: idea.colour_name, photo: null, image: null }}
        sizes="4rem"
        className="aspect-[4/5] w-16 shrink-0 self-start rounded-[var(--radius-tile)]"
      />
      <div className="min-w-0 flex-1">
        <p className="caption">{GARMENT_LABELS[idea.garment_type]}</p>
        <p className="mt-0.5 text-[0.9375rem] leading-snug font-medium">{idea.name}</p>
        {made ? <p className="mt-0.5 text-[0.8125rem] text-ink-3">{made}</p> : null}
        <p className="prose mt-1 text-[0.875rem] leading-snug text-ink-2">{idea.why}</p>
        {state?.errors?.request ? <p className="mt-1 text-[0.8125rem] text-alert">{state.errors.request}</p> : null}
      </div>
      <form action={action} className="shrink-0">
        <input type="hidden" name="request" value={idea.search} />
        <SubmitButton variant="quiet" size="small" pending="Starting">
          Search
        </SubmitButton>
      </form>
    </li>
  )
}
