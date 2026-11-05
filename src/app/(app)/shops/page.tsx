import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { PriceLine, sizeLine } from '@/components/feed/product'
import { ProductPhoto } from '@/components/feed/product-photo'
import { PageTitle } from '@/components/section'
import { Live } from '@/components/sub-page'
import { listSlots, type Slot } from '@/lib/blueprint'
import { db } from '@/lib/db'
import { CARDS_PER_SLOT, REASON_LABELS } from '@/lib/feed'
import { OPEN_STATUSES } from '@/lib/finder/filter'
import { SHOW_THRESHOLD } from '@/lib/finder/score'
import { listRetailers } from '@/lib/retailers'
import { parseShopQuery, shopQueryString, type ShopQuery } from '@/lib/shop-query'
import { defaultSlot, searchShops, type ShopPage, type ShopPiece } from '@/lib/shops'
import { GARMENT_LABELS, GARMENT_TYPES } from '@/lib/wardrobe-values'

import { ShopBrowser } from './browser'
import { SaveFromShops } from './save'
import { ShopsSkeleton } from './skeleton'

export const metadata: Metadata = { title: 'Shops' }

/**
 * Everything the finder read, not only what made the feed. Reached from
 * Finds, so the Finds tab stays lit.
 */
export default function ShopsPage({ searchParams }: PageProps<'/shops'>) {
  return (
    <section>
      <BackLink href="/finds" label="Finds" />
      <div className="mt-3">
        <PageTitle title="Shops" line="Everything the finder read in the shops you have on, including what it passed over." />
      </div>
      <Suspense fallback={<ShopsSkeleton />}>
        <Live>
          <Content searchParams={searchParams} />
        </Live>
      </Suspense>
    </section>
  )
}

async function Content({ searchParams }: Pick<PageProps<'/shops'>, 'searchParams'>) {
  const query = parseShopQuery(await searchParams)
  const [slots, retailers] = await Promise.all([listSlots(), listRetailers(db())])
  const open = slots.filter((slot) => (OPEN_STATUSES as readonly string[]).includes(slot.status))
  const result = await searchShops(query)
  // An old link past the end, after the catalogue shrank: the last page instead.
  if (result.page > result.pages) redirect(`/shops${shopQueryString(query, result.pages)}`)
  const byId = new Map(slots.map((slot) => [slot.id, slot]))

  return (
    <ShopBrowser
      query={query}
      kinds={GARMENT_TYPES.map((garment) => ({ value: garment, label: GARMENT_LABELS[garment] }))}
      shops={retailers.filter((retailer) => retailer.enabled).map((retailer) => ({ value: retailer.slug, label: retailer.name }))}
      page={result.page}
      pages={result.pages}
      previousHref={result.page > 1 ? `/shops${shopQueryString(query, result.page - 1)}` : null}
      nextHref={result.page < result.pages ? `/shops${shopQueryString(query, result.page + 1)}` : null}
    >
      {result.pieces.length > 0 ? (
        <>
          <p className="headline mt-8 text-[1.25rem]">{summary(result, query)}</p>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {result.pieces.map((piece) => (
              <Tile key={piece.product_id} piece={piece} slots={byId} open={open} />
            ))}
          </ul>
        </>
      ) : (
        <Empty result={result} query={query} />
      )}
    </ShopBrowser>
  )
}

function summary(result: ShopPage, query: ShopQuery): string {
  const count = `${result.total.toLocaleString('en-NZ')} ${result.total === 1 ? 'piece' : 'pieces'}`
  const words = query.q ? ` for “${query.q}”` : ''
  const size = query.size === 'mine' ? ' in your size' : ''
  const order = { closest: 'closest to your slots first', newest: 'newest first', price: 'cheapest first' }[query.sort]
  return `${count}${words}${size}, ${order}.`
}

function Empty({ result, query }: { result: ShopPage; query: ShopQuery }) {
  const filtered = query.q !== '' || query.kind !== null || query.shop !== null
  if (!filtered && !result.read) {
    return (
      <div className="mt-12">
        <h2 className="headline text-[1.5rem]">Nothing read yet</h2>
        <p className="mt-3 max-w-[42ch] text-ink-2">
          Every night the finder reads the shops. Once it has, everything it found is here to search.
        </p>
      </div>
    )
  }
  return (
    <div className="mt-12">
      <h2 className="headline text-[1.5rem]">Nothing matches</h2>
      <p className="mt-3 max-w-[42ch] text-ink-2">
        {query.q ? 'Try fewer words, or another spelling' : 'Try another kind or shop'}
        {query.size === 'mine' ? ', or every size.' : '.'}
      </p>
    </div>
  )
}

/** What the finder made of it, or what he did with it, in a few words. */
function verdict(piece: ShopPiece, slots: Map<number, Slot>): { text: string; tone: 'accent' | 'quiet' } | null {
  const yours = (slotId: number | null) => {
    const slot = slotId === null ? null : slots.get(slotId)
    return slot ? `your ${slot.name.toLowerCase()}` : null
  }
  if (piece.action?.kind === 'saved') {
    const slot = yours(piece.action.slot_id)
    return { text: slot ? `Saved, for ${slot}` : 'Saved', tone: 'accent' }
  }
  if (piece.action?.kind === 'bought') return { text: 'Bought', tone: 'quiet' }
  if (piece.action?.kind === 'dismissed') {
    const reason = piece.action.reason ? REASON_LABELS[piece.action.reason].toLowerCase() : null
    return { text: reason ? `Dismissed: ${reason}` : 'Dismissed', tone: 'quiet' }
  }
  if (piece.judged) {
    const { score, slot_id } = piece.judged
    if (piece.on_today) return { text: `On Finds, match ${score}`, tone: 'accent' }
    const slot = slot_id === null ? null : slots.get(slot_id)
    if (!slot) return { text: slot_id === null ? `Match ${score}, for none of your slots` : `Match ${score}`, tone: 'quiet' }
    const match = `Match ${score} for ${yours(slot.id)}`
    if (slot.status === 'owned') return { text: `${match}, which you own`, tone: 'quiet' }
    if (slot.status === 'retired') return { text: `${match}, a retired slot`, tone: 'quiet' }
    // It clears the bar, but the feed shows only each slot's best few.
    if (score >= SHOW_THRESHOLD && piece.shortlisted) {
      return { text: `${match}, behind the best ${CARDS_PER_SLOT} on Finds`, tone: 'quiet' }
    }
    return { text: match, tone: 'quiet' }
  }
  if (piece.shortlisted) return { text: 'Shortlisted, not judged yet', tone: 'quiet' }
  return null
}

function Tile({ piece, slots, open }: { piece: ShopPiece; slots: Map<number, Slot>; open: Slot[] }) {
  const line = verdict(piece, slots)
  const kept = piece.action?.kind === 'saved' || piece.action?.kind === 'bought'
  const sameKind = open.filter((slot) => slot.garment_type === piece.garment_type)
  const others = open.filter((slot) => slot.garment_type !== piece.garment_type)
  const option = (slot: Slot) => ({ id: slot.id, name: slot.name })

  return (
    <li className="flex min-w-0 flex-col">
      <a href={piece.url} target="_blank" rel="noopener noreferrer" className="pressable block rounded-[var(--radius-tile)]">
        <ProductPhoto
          find={piece}
          sizes="(min-width: 1280px) 14rem, (min-width: 1024px) 17rem, (min-width: 640px) 13rem, 45vw"
          className="aspect-[4/5] rounded-[var(--radius-tile)]"
        />
        <p className="caption mt-2.5 truncate">{piece.retailer}</p>
        <h2 className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium">{piece.title}</h2>
      </a>
      <div className="mt-1">
        <PriceLine find={piece} />
      </div>
      {line ? (
        <p className={`mt-1.5 text-[0.8125rem] leading-snug ${line.tone === 'accent' ? 'font-medium text-accent' : 'text-ink-3'}`}>
          {line.text}
        </p>
      ) : null}
      {piece.judged?.why ? (
        <p className="mt-1 line-clamp-3 text-[0.8125rem] leading-snug text-ink-2">{piece.judged.why}</p>
      ) : null}
      {piece.sizes.length > 0 ? <p className="mt-1 text-[0.8125rem] text-ink-3">{sizeLine(piece)}</p> : null}
      {piece.try_on ? <p className="mt-1 text-[0.8125rem] text-ink-3">Try on at {piece.try_on}</p> : null}
      {kept ? null : (
        <SaveFromShops
          productId={piece.product_id}
          title={piece.title}
          defaultSlotId={defaultSlot(piece, open)}
          sameKind={sameKind.map(option)}
          others={others.map(option)}
          again={piece.action?.kind === 'dismissed'}
        />
      )}
    </li>
  )
}
