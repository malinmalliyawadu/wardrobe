import { PieceImage } from '@/components/piece-image'
import type { Source, Subject } from '@/lib/on-me'
import { GARMENT_LABELS } from '@/lib/wardrobe-values'

/** The small line over a picture's name: what kind of thing it was made from. */
export function eyebrow(subject: Subject): string {
  switch (subject.kind) {
    case 'find':
      return subject.retailer ? `Find, ${subject.retailer}` : 'Find'
    case 'look':
      return subject.occasion ? `Look, ${subject.occasion}` : 'Look'
    case 'outfit':
      return subject.count === 1 ? 'Your choice' : `Your choice, ${subject.count} pieces`
  }
}

/** A picture's sources in miniature, under its tile: up to four, then how many more. */
export function SourceStrip({ sources }: { sources: Source[] }) {
  const shown = sources.slice(0, 4)
  const more = sources.length - shown.length
  return (
    <div className="flex items-center gap-1.5" aria-label={`Made from ${sources.map((source) => source.name).join(', ')}`} role="img">
      {shown.map((source) => (
        <PieceImage key={source.key} piece={source} sizes="2rem" className="h-10 w-[1.875rem] shrink-0 rounded-[var(--radius-tile)]" />
      ))}
      {more > 0 ? <span className="pl-0.5 text-[0.8125rem] text-ink-3 tabular-nums">+{more}</span> : null}
    </div>
  )
}

/** How a source reached OpenAI, in words for the picture's own page. */
export function shownLine(source: Source): string {
  const whose = source.kind === 'piece' ? 'Yours' : source.kind === 'saved' ? 'Saved find' : 'Find'
  const garment = source.garment_type ? GARMENT_LABELS[source.garment_type].toLowerCase() : null
  const how =
    source.shown === 'photo'
      ? 'your photo of it'
      : source.shown === 'product'
        ? 'the shop’s photo'
        : source.colour_name
          ? `described in words, ${source.colour_name}`
          : 'described in words'
  return [whose, garment, how].filter(Boolean).join(', ')
}
