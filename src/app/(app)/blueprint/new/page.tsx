import type { Metadata } from 'next'
import { connection } from 'next/server'

import { SubPage } from '@/components/sub-page'
import { listSlots, sentenceCase } from '@/lib/blueprint'
import { getProfile } from '@/lib/profile'
import { getSearch } from '@/lib/search'
import { getGuide } from '@/lib/style-guide'

import { SlotForm } from '../slot-form'
import { ceilings, formValues, paletteSwatches } from '../slot-values'

export const metadata: Metadata = { title: 'Add a slot' }

export default function NewSlotPage({ searchParams }: PageProps<'/blueprint/new'>) {
  return (
    <SubPage
      title="Add a slot"
      intro="Something you want that the draft missed, or something you own that the blueprint should build around. A redraft keeps it."
      back={{ href: '/blueprint', label: 'Blueprint' }}
    >
      <Form searchParams={searchParams} />
    </SubPage>
  )
}

async function Form({ searchParams }: Pick<PageProps<'/blueprint/new'>, 'searchParams'>) {
  await connection()
  const [profile, guide, slots, params] = await Promise.all([getProfile(), getGuide(), listSlots(), searchParams])
  // From a search's "Add to blueprint": the slot starts as what he searched for.
  const searchId = Number(typeof params.search === 'string' ? params.search : NaN)
  const search = Number.isInteger(searchId) && searchId > 0 ? await getSearch(searchId) : null
  const initial = formValues(null)
  if (search?.target) {
    const target = search.target
    // "A navy overshirt under $300" names the slot "Navy overshirt"; the price goes in the band.
    initial.name = sentenceCase(
      (search.summary ?? search.request)
        .replace(/\s+(under|below|up to|around|about|for|from)\s+\$.*$/i, '')
        .replace(/^(an?|some)\s+/i, ''),
    )
    initial.why = `You searched for it: “${search.request}”.`
    initial.garment_type = target.garment_type
    initial.colour_family = target.colours.join(', ')
    // The palette swatches his colour words name ("navy" is his "ink navy"), up to the form's three.
    const palette = guide ? [...guide.palette.best, ...guide.palette.neutrals] : []
    initial.colours = palette
      .filter((colour) => target.colours.some((word) => colour.name.toLowerCase().split(/\s+/).includes(word)))
      .map((colour) => colour.hex)
      .slice(0, 3)
    initial.fabrics = target.fabrics.join(', ')
    initial.fit = target.fit ?? ''
    initial.budget_min = target.min_cents === null ? null : Math.round(target.min_cents / 100)
    initial.budget_max = target.max_cents === null ? null : Math.round(target.max_cents / 100)
  }
  // Keyed on the slot count, so coming back after adding one starts a fresh form.
  return (
    <SlotForm
      key={`${slots.length}-${search?.id ?? 'blank'}`}
      initial={initial}
      {...paletteSwatches(guide)}
      ceilings={ceilings(profile)}
    />
  )
}
