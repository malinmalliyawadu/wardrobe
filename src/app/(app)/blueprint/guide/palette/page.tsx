import type { Metadata } from 'next'
import { connection } from 'next/server'

import { SubPage } from '@/components/sub-page'
import { getGuide } from '@/lib/style-guide'

import { NoGuide } from '../no-guide'
import { PaletteForm } from './form'

export const metadata: Metadata = { title: 'Edit palette' }

export default function PalettePage() {
  return (
    <SubPage
      title="Palette"
      intro="Slots take their colours from here, and the finder checks products against it. Tap a swatch to pick by eye, or type the hex."
      back={{ href: '/blueprint/guide', label: 'Style guide' }}
    >
      <Loaded />
    </SubPage>
  )
}

async function Loaded() {
  await connection()
  const guide = await getGuide()
  if (!guide) return <NoGuide />
  return <PaletteForm key={guide.edited_at?.toISOString() ?? 'drafted'} palette={guide.palette} />
}
