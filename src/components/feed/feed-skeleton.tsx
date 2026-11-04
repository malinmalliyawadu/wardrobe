import { Bone, Skeleton, TextBone } from '@/components/skeleton'

/** Today's feed while it streams: Saved, then one slot's row of finds, in their real proportions. */
export function FeedSkeleton() {
  return (
    <Skeleton label="Loading your finds">
      <div className="mt-16 border-t border-line pt-8">
        <Heading />
        <div className="mt-2 divide-y divide-line">
          {[0, 1].map((row) => (
            <div key={row} className="flex gap-4 py-4">
              <Bone className="aspect-[4/5] w-20 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 text-[0.9375rem]">
                <TextBone className="w-24" size="text-[0.8125rem]" />
                <TextBone className="w-11/12" />
                <TextBone className="w-14" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-16 border-t border-line pt-8">
        <Heading />
        <div className="mt-2 max-w-[44ch] text-[0.9375rem]">
          <TextBone className="w-full" />
          <TextBone className="w-2/3" />
        </div>
        <div className="mt-12 flex items-center gap-3">
          <Bone className="h-11 w-11 shrink-0 rounded-lg" />
          <div className="flex-1">
            <span className="flex h-[1.65rem] items-center text-[1.3125rem]">
              <Bone className="h-[0.7em] w-48 rounded-full" />
            </span>
            <TextBone className="w-20" size="text-[0.8125rem]" />
          </div>
        </div>
        {/* The swipe row's first two cards on the phone, the grid's three on a laptop. */}
        <div className="-mx-5 mt-5 flex gap-4 overflow-hidden px-5 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-x-6 lg:px-0">
          {[0, 1, 2].map((card) => (
            <div key={card} className="w-[15.5rem] shrink-0 sm:w-[16.5rem] lg:w-auto">
              <Bone className="aspect-[4/5] rounded-xl" />
              <div className="mt-3 text-[0.9375rem]">
                <TextBone className="w-20" size="text-[0.8125rem]" />
                <TextBone className="w-11/12" />
                <TextBone className="w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Skeleton>
  )
}

function Heading() {
  return (
    <span className="flex h-[2.1rem] items-center text-[1.75rem]">
      <Bone className="h-[0.7em] w-32 rounded-full" />
    </span>
  )
}
