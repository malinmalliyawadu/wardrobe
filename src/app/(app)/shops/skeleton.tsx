import { Bone, Skeleton, TextBone } from '@/components/skeleton'

/** The search, its four filters, the count, then a grid of tiles: photo, shop, name, price, verdict. */
export function ShopsSkeleton() {
  return (
    <Skeleton label="Loading the shops">
      <Bone className="mt-8 h-12 rounded-xl" />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((filter) => (
          <Bone key={filter} className="h-12 rounded-xl" />
        ))}
      </div>
      <span className="mt-8 flex h-[1.79rem] items-center text-[1.375rem]">
        <Bone className="h-[0.7em] w-64 max-w-full rounded-full" />
      </span>
      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((tile) => (
          <div key={tile}>
            <Bone className="aspect-[4/5] rounded-xl" />
            <div className="mt-2.5 text-[0.75rem]">
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
