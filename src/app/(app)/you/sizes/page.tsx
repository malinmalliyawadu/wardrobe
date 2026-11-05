import type { Metadata } from 'next'

import { Live, SubPage } from '@/components/sub-page'
import { getProfile } from '@/lib/profile'

import { SizesForm } from './form'

export const metadata: Metadata = { title: 'Height and sizes' }

export default function SizesPage() {
  return (
    <SubPage title="Height and sizes" intro="Measured, in centimetres. Leave what you do not know blank.">
      <Live>
        <Loaded />
      </Live>
    </SubPage>
  )
}

async function Loaded() {
  const profile = await getProfile()
  return <SizesForm heightCm={profile.height_cm} sizes={profile.sizes} fits={profile.fit_preferences} />
}
