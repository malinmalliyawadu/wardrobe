import { Bone, FormBones, Skeleton, TextBone } from '@/components/skeleton'

/* The Looks tab's pages while they stream, each in the shape of what lands. */

function SectionHeading({ width = 'w-36' }: { width?: string }) {
  return (
    <span className="flex h-[2.05rem] items-center text-[1.625rem]">
      <Bone className={`h-[0.7em] rounded-full ${width}`} />
    </span>
  )
}

/** A set's heading, then two looks: the laid-out pieces, the label line, the name and the why. */
export function LooksSkeleton() {
  return (
    <Skeleton label="Loading your looks">
      <div className="mt-12 border-b border-line pb-3">
        <SectionHeading width="w-28" />
        <div className="mt-1 text-sm">
          <TextBone className="w-56 max-w-full" />
        </div>
      </div>
      <div className="mt-8 grid gap-x-8 gap-y-14 sm:grid-cols-2">
        {[0, 1].map((look) => (
          <div key={look}>
            <div className="grid grid-cols-6 gap-2">
              <Bone className="col-span-4 row-span-2 aspect-[3/4] rounded-xl" />
              <Bone className="col-span-2 h-full rounded-xl" />
              <Bone className="col-span-2 h-full rounded-xl" />
              <Bone className="col-span-3 h-24 rounded-xl sm:h-28" />
              <Bone className="col-span-3 h-24 rounded-xl sm:h-28" />
            </div>
            <div className="mt-4 text-[0.8125rem]">
              <TextBone className="w-48" />
            </div>
            <span className="mt-1.5 flex h-[1.65rem] items-center text-[1.5rem]">
              <Bone className="h-[0.7em] w-3/5 rounded-full" />
            </span>
            <div className="mt-2.5 text-[0.9375rem]">
              <TextBone className="w-full" />
              <TextBone className="w-full" />
              <TextBone className="w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}

/** The count line and its button, then a shelf of tiles. */
export function PiecesSkeleton() {
  return (
    <Skeleton label="Loading your pieces">
      <div className="mt-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <div className="w-56 text-[1.375rem]">
          <TextBone className="w-full" />
        </div>
        <Bone className="h-12 w-36 rounded-full" />
      </div>
      <div className="mt-12 border-b border-line pb-3">
        <SectionHeading width="w-20" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div key={tile}>
            <Bone className="aspect-[3/4] rounded-xl" />
            <div className="mt-2.5 text-[0.9375rem]">
              <TextBone className="w-4/5" />
            </div>
            <div className="mt-1 text-[0.8125rem]">
              <TextBone className="w-16" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}

/** One piece: its picture beside its name, then the details form. */
export function PieceSkeleton() {
  return (
    <Skeleton label="Loading the piece">
      <div className="mt-4 grid gap-6 sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-end sm:gap-8">
        <Bone className="aspect-[3/4] w-56 rounded-xl sm:w-auto" />
        <div>
          <span className="flex h-[1.05em] items-center text-[2.25rem] sm:text-[2.75rem]">
            <Bone className="h-[0.7em] w-4/5 rounded-full" />
          </span>
          <div className="mt-3 text-[0.9375rem]">
            <TextBone className="w-48" />
          </div>
        </div>
      </div>
      <div className="mt-12 border-t border-line pt-6">
        <SectionHeading width="w-24" />
      </div>
      <FormBones fields={4} />
    </Skeleton>
  )
}

/** The three ways in, then the photo tile. */
export function AddPieceSkeleton() {
  return (
    <Skeleton label="Loading">
      <div className="mt-8 grid grid-cols-3 gap-1.5 sm:flex sm:gap-2">
        {[0, 1, 2].map((mode) => (
          <Bone key={mode} className="h-11 rounded-full sm:w-28" />
        ))}
      </div>
      <div className="mt-6 max-w-[44ch] text-[0.9375rem]">
        <TextBone className="w-full" />
        <TextBone className="w-3/4" />
      </div>
      <Bone className="mt-5 aspect-[3/4] w-44 rounded-xl" />
    </Skeleton>
  )
}

/** The count line and its button, then a grid of pictures, each with its small sources. */
export function OnMeSkeleton() {
  return (
    <Skeleton label="Loading the pictures">
      <div className="mt-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <div className="w-56 text-[1.375rem]">
          <TextBone className="w-full" />
        </div>
        <Bone className="h-12 w-40 rounded-full" />
      </div>
      <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div key={tile}>
            <Bone className="aspect-[3/4] rounded-xl" />
            <div className="mt-2.5 text-[0.75rem]">
              <TextBone className="w-20" />
            </div>
            <div className="mt-0.5 text-[0.9375rem]">
              <TextBone className="w-4/5" />
            </div>
            <div className="mt-2 flex gap-1.5">
              <Bone className="h-10 w-[1.875rem] rounded-[0.3rem]" />
              <Bone className="h-10 w-[1.875rem] rounded-[0.3rem]" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}

/** One picture: the label line and name, the picture, and what it was made from beside it. */
export function PictureSkeleton() {
  return (
    <Skeleton label="Loading the picture">
      <div className="mt-2 text-[0.8125rem]">
        <TextBone className="w-28" />
      </div>
      <span className="mt-1 flex h-[1.05em] items-center text-[2.25rem] sm:text-[2.75rem]">
        <Bone className="h-[0.7em] w-4/5 rounded-full" />
      </span>
      <div className="mt-6 grid gap-8 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Bone className="aspect-[3/4] rounded-xl" />
        <div>
          <div className="border-b border-line pb-2 text-sm">
            <TextBone className="w-20" />
          </div>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 py-3">
              <Bone className="h-16 w-12 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 text-[0.9375rem]">
                <TextBone className="w-3/4" />
                <TextBone className="w-1/2" size="text-[0.8125rem]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Skeleton>
  )
}

/** A group's heading, then a grid of tiles to tick. */
export function ChooseSkeleton() {
  return (
    <Skeleton label="Loading your pieces">
      <div className="mt-12 border-b border-line pb-3">
        <SectionHeading width="w-32" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4">
        {[0, 1, 2].map((tile) => (
          <div key={tile}>
            <Bone className="aspect-[3/4] rounded-xl" />
            <div className="mt-2 text-[0.875rem]">
              <TextBone className="w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
