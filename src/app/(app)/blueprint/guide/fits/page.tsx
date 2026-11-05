import type { Metadata } from 'next'
import { connection } from 'next/server'

import { SubPage } from '@/components/sub-page'
import { getGuide } from '@/lib/style-guide'

import { NoGuide } from '../no-guide'
import { FitsForm } from './form'

export const metadata: Metadata = { title: 'Edit fit by garment' }

export default function FitsPage() {
  return (
    <SubPage
      title="Fit by garment"
      intro="The retailer fit labels that work on you, garment by garment. The finder drops products cut any other way."
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
  return <FitsForm key={guide.edited_at?.toISOString() ?? 'drafted'} fits={guide.fit_vocabulary} />
}
