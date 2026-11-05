import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { ChevronIcon } from '@/components/icons'
import { PieceImage } from '@/components/piece-image'
import { SectionHead } from '@/components/section'
import { Live } from '@/components/sub-page'
import { day } from '@/lib/format'
import { getOnMe, type OnMeDetail, type Source } from '@/lib/on-me'

import { PictureSkeleton } from '../../skeletons'
import { Making } from '../making'
import { eyebrow, shownLine } from '../sources'
import { MakeAgain } from './again'

export const metadata: Metadata = { title: 'On me' }

export default function PicturePage({ params }: PageProps<'/wardrobe/on-me/[id]'>) {
  return (
    <section>
      <BackLink href="/wardrobe/on-me" label="On me" />
      <Suspense fallback={<PictureSkeleton />}>
        <Live>
          <Content params={params} />
        </Live>
      </Suspense>
    </section>
  )
}

async function Content({ params }: Pick<PageProps<'/wardrobe/on-me/[id]'>, 'params'>) {
  const { id } = await params
  const numeric = Number(id)
  const picture = Number.isInteger(numeric) && numeric > 0 ? await getOnMe(numeric) : null
  if (!picture) notFound()

  const shop = picture.subject.kind === 'find' ? picture.sources[0]?.href : null
  return (
    <>
      <div className="mt-4 sm:grid sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-10 lg:grid-cols-[30rem_minmax(0,1fr)] lg:gap-16">
        <figure className="min-w-0">
          {picture.status === 'making' ? (
            <Making id={picture.id} className="aspect-[3/4] rounded-[var(--radius-tile)]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a private, already-sized file; the optimiser would only copy it
            <img
              src={`/photos/try-ons/${picture.id}`}
              alt={`You, ${picture.subject.title}`}
              width={picture.width ?? undefined}
              height={picture.height ?? undefined}
              className="h-auto w-full rounded-[var(--radius-tile)] bg-surface"
            />
          )}
          <figcaption className="mt-4">
            <p className="caption">{eyebrow(picture.subject)}</p>
            <h1 className="display mt-1 text-[2rem] sm:text-[2.5rem]">{picture.subject.title}</h1>
            <p className="caption mt-3">
              {picture.status === 'making' ? 'Asked for' : 'Made'} {day(picture.started_at)}
              {picture.usd !== null ? <span className="tabular-nums">, US${picture.usd.toFixed(2)}</span> : null}
            </p>
          </figcaption>
        </figure>

        <section aria-labelledby="made-from" className="mt-12 min-w-0 sm:mt-0">
          <SectionHead id="made-from" title="Made from" aside={picture.sources.length + 1} />
          <ul className="mt-1 divide-y divide-line">
            <li className="flex items-center gap-3 py-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- his photo, through its own private route */}
              <img
                src={`/photos/${picture.photo_id}?v=thumb`}
                alt=""
                width="48"
                height="64"
                className="h-16 w-12 shrink-0 rounded-[var(--radius-tile)] bg-surface object-cover"
              />
              <div className="min-w-0">
                <p className="text-[0.9375rem] leading-snug font-medium">Your full-length photo</p>
                <p className="text-[0.8125rem] leading-snug text-ink-3">Added {day(picture.photo_taken)}</p>
              </div>
            </li>
            {picture.sources.map((source) => (
              <li key={source.key}>
                <SourceRow source={source} />
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-[40ch] text-[0.875rem] leading-snug text-ink-2">{note(picture)}</p>
          <div className="-ml-2 mt-4 flex flex-wrap items-start gap-1">
            {shop ? (
              <a href={shop} target="_blank" rel="noopener" className="text-button">
                At the shop
              </a>
            ) : null}
            {picture.status === 'ready' ? <MakeAgain id={picture.id} /> : null}
          </div>
        </section>
      </div>

      <details className="group mt-14">
        <summary className="pressable -mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
          <ChevronIcon
            width={16}
            height={16}
            className="shrink-0 text-ink-3 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
          />
          What OpenAI was asked
        </summary>
        <p className="caption mt-2">
          {picture.model}
          {picture.size ? `, ${picture.size.replace('x', ' by ')}` : ''}
        </p>
        <div className="mt-3 grid max-w-[60ch] gap-2 text-[0.875rem] leading-relaxed text-ink-2">
          {picture.prompt.split('\n').map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      </details>
    </>
  )
}

function SourceRow({ source }: { source: Source }) {
  const body = (
    <>
      <PieceImage piece={source} sizes="3rem" className="h-16 w-12 shrink-0 rounded-[var(--radius-tile)]" />
      <div className="min-w-0">
        <p className="line-clamp-2 text-[0.9375rem] leading-snug font-medium">{source.name}</p>
        <p className="text-[0.8125rem] leading-snug text-ink-3">{shownLine(source)}</p>
      </div>
    </>
  )
  if (!source.href) return <div className="flex items-center gap-3 py-3">{body}</div>
  const external = !source.href.startsWith('/')
  const className = 'pressable -mx-2 flex items-center gap-3 rounded-[var(--radius-control)] px-2 py-3'
  return external ? (
    <a href={source.href} target="_blank" rel="noopener" className={className}>
      {body}
    </a>
  ) : (
    <Link href={source.href} className={className}>
      {body}
    </Link>
  )
}

/** How to read it: judge colour against the clothes, and what was only described. */
function note(picture: OnMeDetail): string {
  const words = picture.sources.filter((source) => source.shown === 'words').length
  const base = 'Judge the colours against the clothes themselves: the picture cannot know how each one sits on you.'
  if (words === 0) return base
  if (words === picture.sources.length) return `${base} None of these had a photo, so each was drawn from its description.`
  return `${base} ${words === 1 ? 'One piece had' : `${words} pieces had`} no photo, so ${words === 1 ? 'it was' : 'they were'} drawn from the description.`
}
