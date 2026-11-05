import { Bone, Skeleton, TextBone } from '@/components/skeleton'

/** Finds while it streams: the heading and one slot's row of cards, in their real proportions. */
export function FeedSkeleton() {
  return (
    <Skeleton label="Loading your finds">
      <div className="mt-10">
        <span className="flex h-[2.4rem] items-center text-[2.5rem]">
          <Bone className="h-[0.7em] w-3/5 rounded-[2px]" />
        </span>
        <div className="mt-3 max-w-[44ch] text-[0.9375rem]">
          <TextBone className="w-full" />
          <TextBone className="w-2/3" />
        </div>
        <div className="mt-12 flex items-center gap-3">
          <Bone className="h-10 w-10 shrink-0" />
          <div className="flex-1">
            <span className="flex h-[1.4rem] items-center text-[1.125rem]">
              <Bone className="h-[0.7em] w-48 rounded-[2px]" />
            </span>
            <TextBone className="w-20" size="text-[0.8125rem]" />
          </div>
        </div>
        {/* The swipe row's first two cards on the phone, the grid's three on a laptop. */}
        <div className="bleed mt-4 flex gap-3 overflow-hidden px-[var(--gutter)] lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-x-6 lg:px-0 xl:grid-cols-4">
          {[0, 1, 2, 3].map((card) => (
            <div key={card} className={`w-[72vw] max-w-[20rem] shrink-0 sm:w-[20rem] lg:w-auto lg:max-w-none ${card === 3 ? 'hidden xl:block' : ''}`}>
              <Bone className="aspect-[4/5]" />
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
