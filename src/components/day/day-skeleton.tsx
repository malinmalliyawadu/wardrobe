import { Bone, Skeleton, TextBone } from '@/components/skeleton'

/** Today while it streams in: the date line, the forecast, the cover's picture, the first words. */
export function DaySkeleton() {
  return (
    <Skeleton label="Loading today">
      <div className="text-[0.8125rem]">
        <TextBone className="w-48" />
      </div>
      <div className="mt-1 text-[1.0625rem]">
        <TextBone className="w-72 max-w-full" />
      </div>
      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:gap-12">
      <div className="bleed lg:mx-0">
        <Bone className="aspect-[4/5] w-full rounded-none lg:rounded-[var(--radius-tile)]" />
      </div>
      <div className="mt-6 lg:mt-1">
        <span className="flex h-[2.4rem] items-center text-[2.5rem]">
          <Bone className="h-[0.7em] w-2/3 rounded-[2px]" />
        </span>
        <div className="mt-4 text-[1.0625rem]">
          <TextBone className="w-full" />
          <TextBone className="w-5/6" />
        </div>
      </div>
      </div>
    </Skeleton>
  )
}
