import type { Metadata } from 'next'

import { Live, SubPage } from '@/components/sub-page'
import { getProfile } from '@/lib/profile'

import { LifeForm } from './form'

export const metadata: Metadata = { title: 'Your week' }

export default function LifePage() {
  return (
    <SubPage title="Your week" intro="Roughly how the days split. Wellington's weather is already assumed.">
      <Live>
        <Loaded />
      </Live>
    </SubPage>
  )
}

async function Loaded() {
  const profile = await getProfile()
  return <LifeForm life={profile.life} />
}
