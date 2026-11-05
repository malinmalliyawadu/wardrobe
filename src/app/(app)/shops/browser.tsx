'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition, type FormEvent, type MouseEvent, type ReactNode } from 'react'

import { SearchIcon } from '@/components/icons'
import { SIZE_LABELS, SORT_LABELS, type ShopQuery } from '@/lib/shop-query'

type Option = { value: string; label: string }

/*
 * The search and its filters over the results, and the pager under them. The
 * URL holds the whole query, so a search can be shared, reloaded and gone
 * back to. A new search keeps the old results on screen, dimmed, until the
 * new ones land; a changed filter searches at once.
 */
export function ShopBrowser({
  query,
  kinds,
  shops,
  page,
  pages,
  previousHref,
  nextHref,
  children,
}: {
  query: ShopQuery
  kinds: Option[]
  shops: Option[]
  page: number
  pages: number
  previousHref: string | null
  nextHref: string | null
  children: ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function go(href: string, scroll: boolean) {
    startTransition(() => router.push(href, { scroll }))
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    const q = String(form.get('q') ?? '').trim()
    if (q) params.set('q', q)
    for (const [name, fallback] of [
      ['kind', ''],
      ['shop', ''],
      ['size', 'mine'],
      ['sort', 'closest'],
    ] as const) {
      const value = String(form.get(name) ?? '')
      if (value && value !== fallback) params.set(name, value)
    }
    const text = params.toString()
    go(text ? `/shops?${text}` : '/shops', false)
  }

  function turn(event: MouseEvent<HTMLAnchorElement>, href: string) {
    // A new tab or window opens the page as a link would.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    go(href, true)
  }

  const submitOnChange = (event: { currentTarget: HTMLSelectElement }) => event.currentTarget.form?.requestSubmit()
  // Keyed on the query, so going back to an earlier search shows its own words and filters.
  const formKey = [query.q, query.kind, query.shop, query.size, query.sort].join('|')

  return (
    <>
      <form
        key={formKey}
        role="search"
        onSubmit={search}
        className="mt-8 lg:grid lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] lg:gap-3"
      >
        <label htmlFor="shops-q" className="sr-only">
          Search the shops
        </label>
        <div className="relative min-w-0">
          <SearchIcon width={18} height={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
          <input
            id="shops-q"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="Navy overshirt, merino, Barkers"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="field pl-10"
          />
        </div>
        {/* The four filters: a row of their own under the field on the phone, in the field's row on the laptop. */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:contents">
          <Select name="kind" label="Kind of piece" value={query.kind ?? ''} onChange={submitOnChange}>
            <option value="">Every kind</option>
            {kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
          <Select name="shop" label="Shop" value={query.shop ?? ''} onChange={submitOnChange}>
            <option value="">Every shop</option>
            {shops.map((shop) => (
              <option key={shop.value} value={shop.value}>
                {shop.label}
              </option>
            ))}
          </Select>
          <Select name="size" label="Size" value={query.size} onChange={submitOnChange}>
            {Object.entries(SIZE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select name="sort" label="Order" value={query.sort} onChange={submitOnChange}>
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {/* Enter searches; the button is for a keyboard without one, and for screen readers. */}
        <button type="submit" className="sr-only">
          Search
        </button>
      </form>

      <div aria-busy={pending || undefined} className={`transition-opacity duration-150 ease-out ${pending ? 'opacity-55' : ''}`}>
        {children}

        {pages > 1 ? (
          <nav aria-label="Pages" className="mt-12 flex items-center justify-between gap-4">
            {previousHref ? (
              <Link href={previousHref} onClick={(event) => turn(event, previousHref)} className="text-button -ml-2">
                Previous
              </Link>
            ) : (
              <span />
            )}
            <p className="caption tabular-nums">
              Page {page.toLocaleString('en-NZ')} of {pages.toLocaleString('en-NZ')}
            </p>
            {nextHref ? (
              <Link href={nextHref} onClick={(event) => turn(event, nextHref)} className="text-button -mr-2">
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </>
  )
}

function Select({
  name,
  label,
  value,
  onChange,
  children,
}: {
  name: string
  label: string
  value: string
  onChange: (event: { currentTarget: HTMLSelectElement }) => void
  children: ReactNode
}) {
  const id = `shops-${name}`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value} onChange={onChange} className="field">
        {children}
      </select>
    </div>
  )
}
