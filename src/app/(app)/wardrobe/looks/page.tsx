import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/button-link'
import { SectionHead } from '@/components/section'
import { day, list, lookWearLine } from '@/lib/format'
import { gymReadiness, OCCASION_LABELS, readiness, readLooks, todayNz, type Look, type LookKind } from '@/lib/looks'
import { listPieces } from '@/lib/pieces'
import { getGuide } from '@/lib/style-guide'

import { LookCard } from '../look-card'
import { MakeLooks } from '../make-looks'
import { LooksSkeleton } from '../skeletons'
import { WardrobeHead } from '../tabs'

export const metadata: Metadata = { title: 'Looks' }

export default function LooksPage() {
  return (
    <section>
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
      <>
        <WardrobeHead current="looks" line="No style guide yet" />
        <p className="mt-10 max-w-[42ch] text-ink-2">
          Looks are put together against your style guide.{' '}
          <Link href="/blueprint" className="text-accent underline decoration-accent/40 underline-offset-4">
            Draft it
          </Link>{' '}
          first.
        </p>
      </>
    )
  }

  if (kinds.length === 0 && page.saved.length === 0 && page.fresh.length === 0) {
    const active = pieces.filter((piece) => !piece.set_aside_at).length
    return (
      <>
        <WardrobeHead current="looks" line="A few pieces more" />
        <p className="mt-10 max-w-[42ch] text-ink-2">
          {active === 0 ? 'Your wardrobe is empty. ' : `You have ${active} ${active === 1 ? 'piece' : 'pieces'}. `}
          To make a look, add {list(ready.missing)}.
        </p>
        <ButtonLink href="/wardrobe/new" className="mt-5">
          Add a piece
        </ButtonLink>
      </>
    )
  }

  const fresh = page.fresh.length > 0 && page.latest ? page.latest : null
  const noun = (kind: LookKind | undefined, count: number) =>
    kind === 'gym' ? (count === 1 ? 'gym fit' : 'gym fits') : count === 1 ? 'look' : 'looks'
  const line = fresh
    ? `${page.fresh.length} ${noun(fresh.kind, page.fresh.length)} in this set, made ${day(fresh.created_at)}`
    : page.saved.length > 0
      ? `${page.saved.length} saved ${noun(undefined, page.saved.length)}`
      : 'No looks yet'

  const make = (
    <section aria-labelledby="make" className="mt-16">
      <SectionHead
        id="make"
        title={page.latest ? 'New looks' : 'Your first looks'}
        aside={
          page.total.sets > 0
            ? `${page.total.sets} ${page.total.sets === 1 ? 'set' : 'sets'} so far, US$${page.total.usd.toFixed(2)}`
            : undefined
        }
      />
      <p className="prose mt-3 max-w-[48ch] text-[0.9375rem] leading-normal text-ink-2">
        {ready.ready
          ? 'Six outfits from your pieces, for your week and this month in Wellington. Looks you saved or dismissed teach the next set.'
          : gym.ready
            ? `Gym fits from your kit, for this month in Wellington. For everyday looks, add ${list(ready.missing)}.`
            : `To make ${page.latest ? 'more' : 'one'}, add ${list(ready.missing)}.`}
        {someKit && !gym.ready ? ` For gym fits, mark ${list(gym.missing)} as gym kit.` : ''}
      </p>
      {kinds.length > 0 ? (
        <div className="mt-5">
          <MakeLooks first={!page.latest} kinds={kinds} />
        </div>
      ) : null}
    </section>
  )

  return (
    <>
      <WardrobeHead current="looks" line={line} />
      {fresh ? (
        <Section
          id="fresh"
          title={fresh.kind === 'gym' ? 'Gym fits' : 'This set'}
          aside={`From ${fresh.pieces} pieces`}
          hint={fresh.note ? `For "${fresh.note}".` : null}
          looks={page.fresh}
          today={today}
        />
      ) : null}
      {page.fresh.length === 0 ? make : null}
      {page.saved.length > 0 ? (
        <Section
          id="saved"
          title="Saved"
          aside={page.saved.length}
          hint="Kept from earlier sets. Wearing a look saves it."
          looks={page.saved}
          today={today}
        />
      ) : null}
      {page.fresh.length > 0 ? make : null}
    </>
  )
}

function Section({
  id,
  title,
  aside,
  hint,
  looks,
  today,
}: {
  id: string
  title: string
  aside: string | number
  hint: string | null
  looks: Look[]
  today: string
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <SectionHead id={id} title={title} aside={aside} />
      {hint ? <p className="mt-1 text-sm text-ink-3">{hint}</p> : null}
      <div className="mt-6 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {looks.map((look) => (
          <LookCard key={look.id} look={look} today={today} occasion={OCCASION_LABELS[look.occasion]} wornLine={lookWearLine(look)} />
        ))}
      </div>
    </section>
  )
}
