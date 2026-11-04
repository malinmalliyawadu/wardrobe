import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/button-link'
import { day } from '@/lib/format'
import { gymReadiness, OCCASION_LABELS, readiness, readLooks, todayNz, type Look, type LookKind } from '@/lib/looks'
import { listPieces } from '@/lib/pieces'
import { getGuide } from '@/lib/style-guide'

import { LookCard } from './look-card'
import { MakeLooks } from './make-looks'
import { LooksSkeleton } from './skeletons'
import { LooksTabs } from './tabs'

export const metadata: Metadata = { title: 'Looks' }

export default function LooksPage() {
  return (
    <section>
      <LooksTabs current="looks" />
      <p className="mt-5 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">
        Outfits from what you own, put together against your palette, your proportions and your week.
      </p>
      <Suspense fallback={<LooksSkeleton />}>
        <Content />
      </Suspense>
    </section>
  )
}

async function Content() {
  await connection()
  const [pieces, guide, page] = await Promise.all([listPieces(), getGuide(), readLooks()])
  const ready = readiness(pieces)
  const gym = gymReadiness(pieces)
  const kinds: LookKind[] = [...(ready.ready ? ['week' as const] : []), ...(gym.ready ? ['gym' as const] : [])]
  // Some gym kit, but not yet a whole fit: say what it lacks.
  const someKit = pieces.some((piece) => !piece.set_aside_at && piece.worn_for !== 'everyday')
  const today = todayNz()

  if (!guide) {
    return (
      <p className="mt-10 border-t border-line pt-6 text-ink-2">
        Looks are put together against your style guide.{' '}
        <Link href="/blueprint" className="text-brass underline decoration-brass/40 underline-offset-4">
          Draft it
        </Link>{' '}
        first.
      </p>
    )
  }

  if (kinds.length === 0 && page.saved.length === 0 && page.fresh.length === 0) {
    const active = pieces.filter((piece) => !piece.set_aside_at).length
    return (
      <div className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-[1.625rem] leading-tight">A few pieces more</h2>
        <p className="mt-3 max-w-[42ch] text-ink-2">
          {active === 0 ? 'Your wardrobe is empty. ' : `You have ${active} ${active === 1 ? 'piece' : 'pieces'}. `}
          To make a look, add {list(ready.missing)}.
        </p>
        <ButtonLink href="/looks/pieces/new" className="mt-6">
          Add a piece
        </ButtonLink>
      </div>
    )
  }

  const make = (
    <section aria-labelledby="make" className="mt-14 border-t border-line pt-8">
      <h2 id="make" className="font-display text-[1.625rem] leading-tight">
        {page.latest ? 'New looks' : 'Your first looks'}
      </h2>
      <p className="mt-2 max-w-[42ch] text-ink-2">
        {ready.ready
          ? 'Six outfits from your pieces, for your week and this month in Wellington. Looks you saved or dismissed teach the next set.'
          : gym.ready
            ? `Gym fits from your kit, for this month in Wellington. For everyday looks, add ${list(ready.missing)}.`
            : `To make ${page.latest ? 'more' : 'one'}, add ${list(ready.missing)}.`}
        {someKit && !gym.ready ? ` For gym fits, mark ${list(gym.missing)} as gym kit.` : ''}
      </p>
      {kinds.length > 0 ? (
        <div className="mt-6">
          <MakeLooks first={!page.latest} kinds={kinds} />
        </div>
      ) : null}
      {page.total.sets > 0 ? (
        <p className="mt-6 text-sm text-ink-3 tabular-nums">
          {page.total.sets} {page.total.sets === 1 ? 'set' : 'sets'} so far, US${page.total.usd.toFixed(2)} in all.
        </p>
      ) : null}
    </section>
  )

  return (
    <>
      {page.fresh.length > 0 && page.latest ? (
        <Section
          id="fresh"
          title={page.latest.kind === 'gym' ? 'Gym fits' : 'This set'}
          hint={`Made ${day(page.latest.created_at)} from ${page.latest.pieces} pieces${page.latest.note ? `, for "${page.latest.note}"` : ''}.`}
          looks={page.fresh}
          today={today}
        />
      ) : null}
      {page.fresh.length === 0 ? make : null}
      {page.saved.length > 0 ? (
        <Section id="saved" title="Saved" hint="Looks you kept from earlier sets. Wearing a look saves it." looks={page.saved} today={today} />
      ) : null}
      {page.fresh.length > 0 ? make : null}
    </>
  )
}

function Section({ id, title, hint, looks, today }: { id: string; title: string; hint: string; looks: Look[]; today: string }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <div className="border-b border-line pb-3">
        <h2 id={id} className="font-display text-[1.625rem] leading-tight">
          {title}
        </h2>
        <p className="mt-1 text-sm text-ink-3">{hint}</p>
      </div>
      <div className="mt-8 grid gap-x-8 gap-y-14 sm:grid-cols-2">
        {looks.map((look) => (
          <LookCard key={look.id} look={look} today={today} occasion={OCCASION_LABELS[look.occasion]} wornLine={wornLine(look.worn)} />
        ))}
      </div>
    </section>
  )
}

/** "Worn twice, last on 2 November." */
function wornLine(worn: string[]): string | null {
  if (worn.length === 0) return null
  const times = worn.length === 1 ? 'once' : worn.length === 2 ? 'twice' : `${worn.length} times`
  return `Worn ${times}, last on ${day(new Date(`${worn[0]}T12:00:00+13:00`))}.`
}

/** "two tops, a pair of trousers and a pair of shoes" */
function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
