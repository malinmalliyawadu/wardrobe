import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/button-link'
import { Swatch } from '@/components/cloth'
import { PieceImage } from '@/components/piece-image'
import { SectionHead } from '@/components/section'
import { inPalette, listPieces, shelve, type Piece } from '@/lib/pieces'
import { colourNameFor, getGuide, type StoredGuide } from '@/lib/style-guide'

import { PiecesSkeleton } from './skeletons'
import { WardrobeHead } from './tabs'

export const metadata: Metadata = { title: 'Wardrobe' }

export default function PiecesPage() {
  return (
    <section>
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
      <>
        <WardrobeHead current="pieces" line="No pieces yet" />
        <p className="mt-10 max-w-[42ch] text-ink-2">
          Start with what you wear most: trousers, tops and shoes. Looks need two tops, a pair of trousers and a pair
          of shoes. Slots you mark owned and finds you buy arrive here on their own.
        </p>
        <ButtonLink href="/wardrobe/new" className="mt-5">
          Add a piece
        </ButtonLink>
      </>
    )
  }

  const palette = active.filter((piece) => inPalette(piece.colour_hex, guide)).length
  const count = `${active.length} ${active.length === 1 ? 'piece' : 'pieces'}`
  const line = guide ? `${count}, ${palette === active.length ? 'all' : palette} in your palette` : count

  return (
    <>
      <WardrobeHead
        current="pieces"
        line={line}
        aside={
          <ButtonLink href="/wardrobe/new" size="small">
            Add a piece
          </ButtonLink>
        }
      />

      {shelve(active).map((group) => (
        <section key={group.title} aria-labelledby={`shelf-${group.title}`} className="mt-12">
          <SectionHead id={`shelf-${group.title}`} title={group.title} aside={group.pieces.length} />
          <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {group.pieces.map((piece) => (
              <li key={piece.id}>
                <Tile piece={piece} guide={guide} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {aside.length > 0 ? (
        <section aria-labelledby="set-aside" className="mt-14">
          <SectionHead id="set-aside" title="Set aside" aside={aside.length} />
          <p className="mt-1 text-sm text-ink-3">Worn out or given away. Looks leave these out.</p>
          <ul className="mt-2 max-w-2xl divide-y divide-line">
            {aside.map((piece) => (
              <li key={piece.id}>
                <Link
                  href={`/wardrobe/${piece.id}`}
                  className="pressable -mx-2 flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] px-2 py-2"
                >
                  <Swatch
                    colour={piece.colour_hex ?? 'var(--surface)'}
                    name={colourNameFor(guide, piece.colour_hex ?? '') ?? piece.colour_name}
                    className="h-9 w-7 shrink-0"
                  />
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
    <Link href={`/wardrobe/${piece.id}`} className="pressable block rounded-[var(--radius-tile)]">
      <PieceImage piece={piece} colour={colour} sizes="(min-width: 1280px) 14rem, (min-width: 1024px) 16rem, (min-width: 640px) 12rem, 45vw" className="aspect-[3/4] rounded-[var(--radius-tile)]" />
      <p className="mt-2.5 line-clamp-2 text-[0.9375rem] leading-snug font-medium">{piece.name}</p>
      {colour ? (
        <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-ink-3">
          {piece.colour_hex ? <Swatch colour={piece.colour_hex} name={colour} className="size-3 shrink-0" /> : null}
          <span className="truncate">{colour}</span>
        </p>
      ) : null}
    </Link>
  )
}
