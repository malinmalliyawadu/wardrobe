import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { FindCard } from '@/components/feed/find-card'
import { PageTitle } from '@/components/section'
import { ShopFilter } from '@/components/shop-filter'
import { Bone, Skeleton, TextBone } from '@/components/skeleton'
import { Live } from '@/components/sub-page'
import { QUALITIES, QUALITY_LABELS, type Quality } from '@/lib/finder/statements'
import { withShop } from '@/lib/shop-filter'
import { getStatements, qualitiesText, type Statements } from '@/lib/statements'

export const metadata: Metadata = { title: 'Statement pieces' }

/**
 * The pieces that carry an outfit, by colour, texture or cut, that Claude
 * chose for him from everything the finder read. Reached from Finds, so the
 * Finds tab stays lit. The filter is the URL, so a view can be gone back to.
 */
export default function StatementsPage({ searchParams }: PageProps<'/statements'>) {
  return (
    <section>
      <BackLink href="/finds" label="Finds" />
      <Suspense fallback={<StatementsSkeleton />}>
        <Live>
          <Content searchParams={searchParams} />
        </Live>
      </Suspense>
    </section>
  )
}

function parseQuality(value: string | string[] | undefined): Quality | null {
  const first = Array.isArray(value) ? value[0] : value
  return (QUALITIES as readonly string[]).includes(first ?? '') ? (first as Quality) : null
}

async function Content({ searchParams }: Pick<PageProps<'/statements'>, 'searchParams'>) {
  const params = await searchParams
  const quality = parseQuality(params.by)
  const statements = await getStatements({ quality, shop: params.shop })
  const { finds, total, shop } = statements
  const shopName = statements.shops.find((option) => option.value === shop)?.label ?? 'this shop'

  return (
    <>
      <div className="mt-3">
        <PageTitle title="Statement pieces" line={line(statements)} />
      </div>
      {total > 0 ? (
        <ShopFilter
          id="statements-shop"
          choices={statements.shops.map((option) => ({ ...option, href: withShop('/statements', { by: quality }, option.value) }))}
          current={shop}
          everyHref={withShop('/statements', { by: quality }, null)}
          beside={<Filter current={quality} statements={statements} />}
        >
          {finds.length > 0 ? (
            <div className="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {finds.map((find) => (
                <FindCard
                  key={find.product_id}
                  find={find}
                  slotName={null}
                  statement={{ qualities: qualitiesText(find.qualities), wearsWith: find.wears_with, outfitOnMe: find.outfit_on_me }}
                  inGrid
                />
              ))}
            </div>
          ) : (
            // A shop with nothing under the quality chosen, kept in the sub-nav so he can see why the grid is empty.
            <p className="mt-8 max-w-[44ch] text-ink-2">
              Nothing from {shopName} stands out by {quality ? QUALITY_LABELS[quality].toLowerCase() : 'colour, texture or cut'}.{' '}
              <Link href={withShop('/statements', {}, shop)} className="font-medium text-accent underline-offset-4 hover:underline">
                See all of its pieces
              </Link>
            </p>
          )}
        </ShopFilter>
      ) : null}
    </>
  )
}

/** What is true now, in one line: how many, what they are, and what is still to come. */
function line({ run, total, waiting }: Statements): string {
  if (!run) {
    return 'Every night the finder looks through everything it reads for pieces that stand out by colour, texture or cut, and judges which suit you. The first are here after the next run.'
  }
  const later =
    waiting > 0
      ? ` ${waiting.toLocaleString('en-NZ')} more ${waiting === 1 ? 'is' : 'are'} judged on the coming nights.`
      : ''
  if (total === 0) return `Nothing has cleared the bar yet.${later}`
  const count = `${total.toLocaleString('en-NZ')} ${total === 1 ? 'piece' : 'pieces'}`
  return `${count} that stand out by colour, texture or cut, in your size and budget, best for you first.${later}`
}

/**
 * All, then each quality with its count in the shop chosen; one with none is
 * left out. Plain links, so nothing moves; each keeps the shop.
 */
function Filter({ current, statements }: { current: Quality | null; statements: Statements }) {
  const items = [
    { key: null, href: withShop('/statements', {}, statements.shop), label: 'All', count: statements.inShop },
    ...QUALITIES.map((quality) => ({
      key: quality,
      href: withShop('/statements', { by: quality }, statements.shop),
      label: QUALITY_LABELS[quality],
      count: statements.byQuality[quality],
    })),
  ].filter((item) => item.count > 0 || item.key === current)
  return (
    <nav aria-label="What makes them a statement" className="subnav">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.key === current ? 'page' : undefined}
          className="subnav-item pressable gap-1.5"
        >
          {item.label}
          <span className="text-ink-3 tabular-nums">{item.count.toLocaleString('en-NZ')}</span>
        </Link>
      ))}
    </nav>
  )
}

/** The title, its line, the filter and a grid of cards, in their real proportions. */
function StatementsSkeleton() {
  return (
    <Skeleton label="Loading statement pieces">
      <span className="mt-3 flex h-[2.4rem] items-center text-[2.5rem] sm:h-[3.1rem] sm:text-[3.25rem]">
        <Bone className="h-[0.7em] w-4/5 max-w-[28rem] rounded-[2px]" />
      </span>
      <div className="mt-3 max-w-[44ch] text-[1.0625rem]">
        <TextBone className="w-full" />
        <TextBone className="w-1/2" />
      </div>
      <Bone className="mt-8 h-11 w-64 max-w-full rounded-[2px]" />
      <div className="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <div key={card} className={card > 0 ? 'hidden sm:block' : ''}>
            <Bone className="aspect-[4/5]" />
            <div className="mt-3 text-[0.9375rem]">
              <TextBone className="w-24" size="text-[0.8125rem]" />
              <TextBone className="w-11/12" />
              <TextBone className="w-16" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
