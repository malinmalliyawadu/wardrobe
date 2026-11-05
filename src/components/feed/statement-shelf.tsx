import Link from 'next/link'
import { connection } from 'next/server'

import { ChevronIcon } from '@/components/icons'
import { Bone, Skeleton, TextBone } from '@/components/skeleton'
import { getStatements } from '@/lib/statements'

import { ProductPhoto } from './product-photo'

const SHOWN = 5

/**
 * The way into the statement pieces, on Finds under the search line: the
 * best few as small photos, what they are, and a tap to the page. Nothing
 * until the finder has looked for them once.
 */
export async function StatementShelf() {
  await connection()
  const { run, finds, total, waiting } = await getStatements({ limit: SHOWN })
  if (!run) return null
  const summary =
    total > 0
      ? `${total.toLocaleString('en-NZ')} chosen for you, by colour, texture or cut`
      : `None over the bar yet, ${waiting.toLocaleString('en-NZ')} still to judge`

  return (
    <Link
      href="/statements"
      className="pressable -mx-2 mt-6 flex min-h-16 items-center gap-4 rounded-[var(--radius-control)] px-2 py-2"
    >
      {finds.length > 0 ? (
        <span aria-hidden className="flex shrink-0 gap-1.5">
          {finds.map((find, index) => (
            <ProductPhoto
              key={find.product_id}
              find={find}
              sizes="3rem"
              className={`aspect-[4/5] w-12 rounded-[var(--radius-tile)] ${index >= 3 ? 'hidden sm:block' : ''}`}
            />
          ))}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="title block text-[1.125rem]">Statement pieces</span>
        <span className="mt-0.5 block text-sm text-ink-2">{summary}</span>
      </span>
      <ChevronIcon className="shrink-0 text-ink-3" />
    </Link>
  )
}

/** The row's shape while it streams: three photos on the phone, five up, and two lines. */
export function StatementShelfSkeleton() {
  return (
    <Skeleton label="Loading statement pieces" className="mt-6 flex min-h-16 items-center gap-4 py-2">
      <span className="flex shrink-0 gap-1.5">
        {[0, 1, 2, 3, 4].map((index) => (
          <Bone key={index} className={`aspect-[4/5] w-12 ${index >= 3 ? 'hidden sm:block' : ''}`} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <TextBone className="w-40" size="text-[1.125rem]" />
        <TextBone className="w-56 max-w-full" size="text-sm" />
      </span>
    </Skeleton>
  )
}
