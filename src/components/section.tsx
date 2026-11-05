import type { ReactNode } from 'react'

/**
 * The line a section opens with: what it is, at the left, and a count, a
 * date or an action at the right. A caption, not a heading, unless `as`
 * says otherwise; sections are told apart by space, not rules.
 */
export function SectionHead({
  id,
  title,
  aside,
  as: Tag = 'h2',
  className = '',
}: {
  id?: string
  title: ReactNode
  aside?: ReactNode
  as?: 'h2' | 'h3' | 'p'
  className?: string
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${className}`}>
      <Tag id={id} className="caption text-ink-2">
        {title}
      </Tag>
      {aside ? <div className="caption shrink-0 tabular-nums">{aside}</div> : null}
    </div>
  )
}

/**
 * A page's opening line: its name, big, and under it one line of what is
 * true right now ("34 slots, 3 already yours"). Only where the name is the
 * content; a page that opens on a picture or a list has no title at all.
 */
export function PageTitle({ title, line, aside }: { title: ReactNode; line?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display text-[2.5rem] sm:text-[3.25rem]">{title}</h1>
        {line ? <p className="prose mt-3 max-w-[44ch] text-[1.0625rem] leading-normal text-ink-2">{line}</p> : null}
      </div>
      {aside ? <div className="shrink-0 pb-1">{aside}</div> : null}
    </div>
  )
}
