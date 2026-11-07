import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense, type ReactNode } from 'react'

import { SectionHead } from '@/components/section'
import { nzDay, times, wearLine } from '@/lib/format'
import { OCCASION_LABELS, type Look } from '@/lib/looks'
import type { Piece } from '@/lib/pieces'
import { colourNameFor, getGuide, type StoredGuide } from '@/lib/style-guide'
import { NEVER_DAYS, readWear, ROTATE_OFFERS, type PieceWear } from '@/lib/wear'

import { WornSkeleton } from '../skeletons'
import { WardrobeHead } from '../tabs'
import { WornLook, WornPiece } from '../worn-rows'

export const metadata: Metadata = { title: 'Worn' }

/*
 * What gets worn and what only gets offered (src/lib/wear.ts), to discard
 * by: the pieces to rotate out first, by a rule said under its name; then
 * his saved looks, the rest of his pieces, the pieces no look has worn, and
 * the looks offered and left. Every list puts what he passes over most at
 * the top, and every row has the one way to discard it.
 */

export default function WornPage() {
  return (
    <section>
      <Suspense fallback={<WornSkeleton />}>
        <Content />
      </Suspense>
    </section>
  )
}

async function Content() {
  await connection()
  const [page, guide] = await Promise.all([readWear(), getGuide()])

  if (!page.since) {
    return (
      <>
        <WardrobeHead current="worn" line="Nothing offered yet" />
        <p className="mt-10 max-w-[42ch] text-ink-2">
          Counts start with your first set of looks or outfit of the day. Tap Wore it today on a look you wear, and this
          page shows what you pass over.
        </p>
      </>
    )
  }

  const line = `${page.days_worn === 0 ? 'Nothing worn' : `Worn on ${page.days_worn} ${page.days_worn === 1 ? 'day' : 'days'}`} since ${nzDay(page.since)}`
  const lookRow = (look: Look) => (
    <WornLook
      key={look.id}
      look={look}
      occasion={OCCASION_LABELS[look.occasion]}
      line={wearLine({ offered: look.offered, on_today: look.on_today, worn: look.worn.length, last_worn: look.worn[0] ?? null })}
    />
  )
  const pieceRow = (piece: Piece, wear: PieceWear | null) => (
    <WornPiece
      key={piece.id}
      piece={piece}
      colour={colourOf(piece, guide)}
      line={wear ? wearLine(wear) : `Never in a look, yours since ${nzDay(piece.created_at.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' }))}.`}
    />
  )

  return (
    <>
      <WardrobeHead current="worn" line={line} />

      <Group
        id="rotate"
        title="Rotate out"
        count={page.rotate.length}
        hint={`Offered ${times(ROTATE_OFFERS)} or more and worn on at most one in four, or in your wardrobe ${NEVER_DAYS} days with no look wearing it.`}
        empty="Nothing yet. Every piece is worn often enough for how often it comes up."
      >
        {page.rotate.map((piece) => pieceRow(piece, piece.wear.offered + piece.wear.worn > 0 ? piece.wear : null))}
      </Group>

      {page.saved.length > 0 ? (
        <Group id="saved" title="Saved looks" count={page.saved.length} hint="Offered often and worn little first.">
          {page.saved.map(lookRow)}
        </Group>
      ) : null}

      {page.pieces.length > 0 ? (
        <Group id="pieces" title={page.rotate.length > 0 ? 'Other pieces' : 'Pieces'} count={page.pieces.length} hint="Counted through the looks they are in, offered often and worn little first.">
          {page.pieces.map((piece) => pieceRow(piece, piece.wear))}
        </Group>
      ) : null}

      {page.never.length > 0 ? (
        <Group id="never" title="Never in a look" count={page.never.length} hint="No look has worn these yet, the longest yours first.">
          {page.never.map((piece) => pieceRow(piece, null))}
        </Group>
      ) : null}

      {page.offered.length > 0 ? (
        <Group id="offered" title="Offered, never saved" count={page.offered.length} hint="Dismissing one tells the next looks why.">
          {page.offered.map(lookRow)}
        </Group>
      ) : null}
    </>
  )
}

function colourOf(piece: Piece, guide: StoredGuide | null): string | null {
  return colourNameFor(guide, piece.colour_hex ?? '') ?? piece.colour_name
}

function Group({
  id,
  title,
  count,
  hint,
  empty,
  children,
}: {
  id: string
  title: string
  count: number
  hint: string
  empty?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <SectionHead id={id} title={title} aside={count} />
      <p className="mt-1 max-w-[60ch] text-sm text-ink-3">{hint}</p>
      {count === 0 && empty ? (
        <p className="mt-4 text-[0.9375rem] text-ink-2">{empty}</p>
      ) : (
        <ul className="mt-4 grid gap-x-12 lg:grid-cols-2">{children}</ul>
      )}
    </section>
  )
}
