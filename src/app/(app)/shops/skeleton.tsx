import { Bone, Skeleton, TextBone } from '@/components/skeleton'

/** The search, its four filters, the count, then a grid of tiles: photo, shop, name, price, verdict. */
export function ShopsSkeleton() {
  return (
    <Skeleton label="Loading the shops">
      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] lg:gap-3">
        <Bone className="h-12 rounded-[var(--radius-control)]" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:contents">
          {[0, 1, 2, 3].map((filter) => (
            <Bone key={filter} className="h-12 rounded-[var(--radius-control)]" />
          ))}
        </div>
      </div>
      <span className="mt-8 flex h-[1.25rem] items-center text-[1.25rem]">
        <Bone className="h-[0.7em] w-64 max-w-full rounded-[2px]" />
      </span>
      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((tile) => (
          <div key={tile}>
            <Bone className="aspect-[4/5]" />
            <div className="mt-2.5 text-[0.8125rem]">
              <TextBone className="w-20" />
            </div>
            <div className="mt-0.5 text-[0.9375rem]">
              <TextBone className="w-full" />
              <TextBone className="w-2/3" />
            </div>
            <div className="mt-1 text-[0.9375rem]">
              <TextBone className="w-12" />
            </div>
            <div className="mt-1.5 text-[0.8125rem]">
              <TextBone className="w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
