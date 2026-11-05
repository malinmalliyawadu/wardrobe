import type { Metadata } from 'next'

import { Live, SubPage } from '@/components/sub-page'
import { getProfile } from '@/lib/profile'

import { BudgetForm } from './form'

export const metadata: Metadata = { title: 'Budget' }

export default function BudgetPage() {
  return (
    <SubPage
      title="Budget"
      intro="Ceilings in New Zealand dollars. Anything above one is dropped before Claude sees it."
    >
      <Live>
        <Loaded />
      </Live>
    </SubPage>
  )
}

async function Loaded() {
  const profile = await getProfile()
  return <BudgetForm budget={profile.budget} />
}
