import { Suspense } from 'react'

import { DayOutfit } from '@/components/day/day-outfit'
import { DaySkeleton } from '@/components/day/day-skeleton'

/**
 * Today is the outfit of the day and nothing else: the picture, the day it
 * is for, the words, the one button. Until there is a guide and a wardrobe
 * it says what to do next. The finds live on their own tab.
 */
export default function TodayPage() {
  return (
    <Suspense fallback={<DaySkeleton />}>
      <DayOutfit />
    </Suspense>
  )
}
