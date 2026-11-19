'use client'

import { useRouter } from 'next/navigation'
import { useTransition, type ReactNode } from 'react'

type Choice = { value: string; label: string; href: string }

/*
 * Shops' own shop select, over a list that is already on the page. The URL
 * holds the choice, so a refresh or going back keeps it; the list stays on
 * screen, dimmed, until the filtered one lands. With one shop in the list
 * there is nothing to choose, so only what sits beside it shows.
 */
export function ShopFilter({
  id,
  choices,
  current,
  everyHref,
  beside,
  children,
}: {
  id: string
  choices: Choice[]
  current: string | null
  everyHref: string
  /** What shares the filter's row on the laptop, above it on the phone (the statement pieces' sub-nav). */
  beside?: ReactNode
  children: ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const offered = choices.length > 1 || current !== null

  function choose(value: string) {
    const href = choices.find((choice) => choice.value === value)?.href ?? everyHref
    startTransition(() => router.push(href, { scroll: false }))
  }

  const select = offered ? (
    // Its own width on the phone too, so it reads as a filter and not as one more field of a form above it.
    <div className="w-60 max-w-full shrink-0">
      <label htmlFor={id} className="sr-only">
        Shop
      </label>
      {/* Keyed on the choice, so going back shows the shop that list was for. */}
      <select
        key={current ?? ''}
        id={id}
        defaultValue={current ?? ''}
        onChange={(event) => choose(event.currentTarget.value)}
        className="field"
      >
        <option value="">Every shop</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  ) : null

  return (
    <>
      {beside ? (
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
          <div className="min-w-0 sm:flex-1">{beside}</div>
          {select}
        </div>
      ) : select ? (
        <div className="mt-10">{select}</div>
      ) : null}
      <div aria-busy={pending || undefined} className={`transition-opacity duration-150 ease-out ${pending ? 'opacity-55' : ''}`}>
        {children}
      </div>
    </>
  )
}
