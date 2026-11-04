import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/button-link'
import { Cloth } from '@/components/cloth'
import { PieceImage } from '@/components/piece-image'
import { inPalette, listPieces, shelve, type Piece } from '@/lib/pieces'
import { colourNameFor, getGuide, type StoredGuide } from '@/lib/style-guide'

import { PiecesSkeleton } from '../skeletons'
import { LooksTabs } from '../tabs'

export const metadata: Metadata = { title: 'Pieces' }

export default function PiecesPage() {
  return (
    <section>
      <LooksTabs current="pieces" />
      <p className="mt-5 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        What you own. Slots you mark owned and finds you buy arrive here on their own; add the rest by photo.
      </p>
      <Suspense fallback={<PiecesSkeleton />}>
        <Content />
      </Suspense>
    </section>
  )
}

async function Content() {
  await connection()
  const [pieces, guide] = await Promise.all([listPieces(), getGuide()])
  const active = pieces.filter((piece) => !piece.set_aside_at)
  const aside = pieces.filter((piece) => piece.set_aside_at)

  if (active.length === 0) {
    return (
      <div className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-[1.625rem] leading-tight">Nothing here yet</h2>
        <p className="mt-3 max-w-[42ch] text-ink-2">
          Start with what you wear most: the trousers, the tops and the shoes. Looks need at least two tops, one
          pair of trousers and one pair of shoes.
        </p>
        <ButtonLink href="/looks/pieces/new" className="mt-6">
          Add a piece
        </ButtonLink>
      </div>
    )
  }

  const palette = active.filter((piece) => inPalette(piece.colour_hex, guide)).length
  return (
    <>
      <div className="mt-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <p className="max-w-[24ch] font-display text-[1.375rem] leading-snug">
          {active.length} {active.length === 1 ? 'piece' : 'pieces'}
          {guide ? `, ${palette === active.length ? 'all' : palette} in your palette` : ''}.
        </p>
        <ButtonLink href="/looks/pieces/new">Add a piece</ButtonLink>
      </div>

      {shelve(active).map((group) => (
        <section key={group.title} aria-labelledby={`shelf-${group.title}`} className="mt-12">
          <h2 id={`shelf-${group.title}`} className="border-b border-line pb-3 font-display text-[1.625rem] leading-tight">
            {group.title}
          </h2>
          <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3">
            {group.pieces.map((piece) => (
              <li key={piece.id}>
                <Tile piece={piece} guide={guide} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {aside.length > 0 ? (
        <section aria-labelledby="set-aside" className="mt-16">
          <div className="border-b border-line pb-3">
            <h2 id="set-aside" className="font-display text-[1.625rem] leading-tight">
              Set aside
            </h2>
            <p className="mt-1 text-sm text-ink-3">Worn out or given away. Looks leave these out.</p>
          </div>
          <ul className="divide-y divide-line">
            {aside.map((piece) => (
              <li key={piece.id}>
                <Link href={`/looks/pieces/${piece.id}`} className="pressable -mx-2 flex items-center gap-3 rounded-xl px-2 py-3">
                  <Cloth colour={piece.colour_hex ?? 'var(--surface)'} className="h-9 w-7 shrink-0 rounded-[0.3rem]" />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{piece.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

function Tile({ piece, guide }: { piece: Piece; guide: StoredGuide | null }) {
  const colour = colourNameFor(guide, piece.colour_hex ?? '') ?? piece.colour_name
  return (
    <Link href={`/looks/pieces/${piece.id}`} className="pressable block rounded-xl">
      <PieceImage
        piece={piece}
        sizes="(min-width: 640px) 12rem, 45vw"
        className="aspect-[3/4] rounded-xl"
      />
      <p className="mt-2.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium">{piece.name}</p>
      {colour ? (
        <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-ink-3">
          {piece.colour_hex ? <Cloth colour={piece.colour_hex} className="size-3 rounded-full" /> : null}
          <span className="truncate">{colour}</span>
        </p>
      ) : null}
    </Link>
  )
}
