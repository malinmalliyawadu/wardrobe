import { connection } from 'next/server'

import { getProfile } from '@/lib/profile'
import { SEASON_INFO, seasonName } from '@/lib/seasons'
import { getGuide } from '@/lib/style-guide'

import { PaletteStrip } from './palette-strip.tsx'

/**
 * The palette strip with his real colours. Streams in under Suspense after
 * the shell, with the blank strip as its fallback; the chips are the same
 * size either way, so nothing moves when it lands.
 */
export async function LivePalette({ size = 'small' }: { size?: 'small' | 'large' }) {
  await connection()
  const [guide, profile] = await Promise.all([getGuide(), getProfile()])
  if (guide) return <PaletteStrip colours={guide.palette.best} label="Your best colours" size={size} />
  const season = profile.confirmed_at ? profile.season : null
  if (season) return <PaletteStrip colours={SEASON_INFO[season].swatches} label={`${seasonName(season)} palette`} size={size} />
  return <PaletteStrip colours={null} size={size} />
}
