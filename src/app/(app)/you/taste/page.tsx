import type { Metadata } from 'next'

import { Live, SubPage } from '@/components/sub-page'
import { getProfile } from '@/lib/profile'

import { TasteForm } from './form'

export const metadata: Metadata = { title: 'Taste' }

export default function TastePage() {
  return (
    <SubPage title="Taste" intro="In your own words. Claude reads this when it drafts the blueprint and judges finds.">
      <Live>
        <Loaded />
      </Live>
    </SubPage>
  )
}

async function Loaded() {
  const profile = await getProfile()
  return <TasteForm taste={profile.taste} />
}
