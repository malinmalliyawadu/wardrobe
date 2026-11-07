import { Bone, FormBones, Skeleton, TextBone } from '@/components/skeleton'

import { WardrobeHead, type WardrobeSection } from './tabs'

/* The Wardrobe tab's pages while they stream, each in the shape of what lands. */

/** The head with its line still to come: the name and the sections show at once, the line is held back like the rest. */
function HeadWaiting({ current }: { current: WardrobeSection }) {
  return (
    <WardrobeHead
      current={current}
      line={
        <span className="skeleton block">
          <TextBone className="w-56 max-w-full" />
        </span>
      }
    />
  )
}

/** A section's opening line: its name at the left, a count at the right. */
function HeadBone({ width = 'w-24' }: { width?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[0.8125rem]">
      <TextBone className={width} />
      <TextBone className="w-5" />
    </div>
  )
}

/** One piece in a grid: the picture, its name, its colour. */
function TileBone() {
  return (
    <div>
      <Bone className="aspect-[3/4]" />
      <div className="mt-2.5 text-[0.9375rem]">
        <TextBone className="w-4/5" />
      </div>
      <div className="mt-1 text-[0.8125rem]">
        <TextBone className="w-16" />
      </div>
    </div>
  )
}

/** The head, then a shelf of tiles. */
export function PiecesSkeleton() {
  return (
    <>
      <HeadWaiting current="pieces" />
      <Skeleton label="Loading your pieces">
        <div className="mt-12">
          <HeadBone width="w-20" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[0, 1, 2, 3].map((tile) => (
            <TileBone key={tile} />
          ))}
        </div>
      </Skeleton>
    </>
  )
}

/** The head, a set's line, then two looks: the laid-out pieces, the caption, the name and the why. */
export function LooksSkeleton() {
  return (
    <>
      <HeadWaiting current="looks" />
      <Skeleton label="Loading your looks">
        <div className="mt-12">
          <HeadBone width="w-16" />
        </div>
        <div className="mt-6 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((look) => (
            <div key={look}>
              <div className="grid grid-cols-6 gap-2">
                <Bone className="col-span-4 row-span-2 aspect-[3/4]" />
                <Bone className="col-span-2 h-full" />
                <Bone className="col-span-2 h-full" />
                <Bone className="col-span-3 h-24 sm:h-28" />
                <Bone className="col-span-3 h-24 sm:h-28" />
              </div>
              <div className="mt-4 text-[0.8125rem]">
                <TextBone className="w-40" />
              </div>
              <span className="mt-2 flex h-[1.5rem] items-center text-[1.5rem]">
                <Bone className="h-[0.7em] w-3/5 rounded-[2px]" />
              </span>
              <div className="mt-3 text-[0.9375rem]">
                <TextBone className="w-full" />
                <TextBone className="w-full" />
                <TextBone className="w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </Skeleton>
    </>
  )
}

/** The head, then a section of rows: a strip of pieces, a caption, a name and a line. */
export function WornSkeleton() {
  return (
    <>
      <HeadWaiting current="worn" />
      <Skeleton label="Loading what you wear">
        <div className="mt-12">
          <HeadBone width="w-24" />
        </div>
        <div className="mt-4 grid gap-x-12 lg:grid-cols-2">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex flex-col gap-3 border-t border-line py-5 sm:flex-row sm:gap-5">
              <div className="flex shrink-0 gap-px">
                {[0, 1, 2, 3].map((piece) => (
                  <Bone key={piece} className="aspect-[3/4] w-11 sm:w-12" />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <TextBone className="w-16" size="text-[0.8125rem]" />
                <div className="mt-1 text-[1.125rem]">
                  <TextBone className="w-3/5" />
                </div>
                <div className="mt-1.5 text-[0.875rem]">
                  <TextBone className="w-4/5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Skeleton>
    </>
  )
}

/** The picture, then the name and the details form beside it on the laptop. */
export function PieceSkeleton() {
  return (
    <Skeleton label="Loading the piece">
      <div className="mt-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-x-12">
        <Bone className="aspect-[3/4] w-56 lg:w-72" />
        <div className="mt-6 max-w-2xl lg:mt-0">
          <span className="flex h-[0.94em] items-center text-[2rem] sm:text-[2.5rem]">
            <Bone className="h-[0.7em] w-4/5 rounded-[2px]" />
          </span>
          <div className="mt-3 text-[0.9375rem]">
            <TextBone className="w-48" />
          </div>
          <div className="mt-12">
            <HeadBone width="w-14" />
          </div>
          <FormBones fields={4} />
        </div>
      </div>
    </Skeleton>
  )
}

/** The three ways in, then the photo tile and its line of help. */
export function AddPieceSkeleton() {
  return (
    <Skeleton label="Loading">
      <div className="mt-6 flex gap-2">
        {['w-20', 'w-24', 'w-24'].map((width) => (
          <Bone key={width} className={`h-11 rounded-[var(--radius-control)] ${width}`} />
        ))}
      </div>
      <Bone className="mt-6 aspect-[3/4] w-44" />
      <div className="mt-3 max-w-[44ch] text-[0.9375rem]">
        <TextBone className="w-full" />
        <TextBone className="w-3/4" />
      </div>
    </Skeleton>
  )
}

/** The head, then a grid of pictures, each with its caption, name and small sources. */
export function OnMeSkeleton() {
  return (
    <>
      <HeadWaiting current="on-me" />
      <Skeleton label="Loading the pictures">
        <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <div key={tile}>
              <Bone className="aspect-[3/4]" />
              <div className="mt-2.5 text-[0.8125rem]">
                <TextBone className="w-20" />
              </div>
              <div className="mt-0.5 text-[0.9375rem]">
                <TextBone className="w-4/5" />
              </div>
              <div className="mt-2 flex gap-1.5">
                <Bone className="h-10 w-[1.875rem]" />
                <Bone className="h-10 w-[1.875rem]" />
              </div>
            </div>
          ))}
        </div>
      </Skeleton>
    </>
  )
}

/** One picture: the picture large with its caption and name under, then what it was made from. */
export function PictureSkeleton() {
  return (
    <Skeleton label="Loading the picture">
      <div className="mt-4 sm:grid sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-10 lg:grid-cols-[30rem_minmax(0,1fr)] lg:gap-16">
        <div>
          <Bone className="aspect-[3/4]" />
          <div className="mt-4 text-[0.8125rem]">
            <TextBone className="w-28" />
          </div>
          <span className="mt-1 flex h-[0.94em] items-center text-[2rem] sm:text-[2.5rem]">
            <Bone className="h-[0.7em] w-4/5 rounded-[2px]" />
          </span>
          <div className="mt-3 text-[0.8125rem]">
            <TextBone className="w-32" />
          </div>
        </div>
        <div className="mt-12 sm:mt-0">
          <HeadBone width="w-20" />
          <div className="mt-1">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 py-3">
                <Bone className="h-16 w-12 shrink-0" />
                <div className="min-w-0 flex-1 text-[0.9375rem]">
                  <TextBone className="w-3/4" />
                  <TextBone className="w-1/2" size="text-[0.8125rem]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Skeleton>
  )
}

/** A group's line, then a grid of tiles to tick. */
export function ChooseSkeleton() {
  return (
    <Skeleton label="Loading your pieces">
      <div className="mt-12">
        <HeadBone width="w-24" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 lg:grid-cols-5">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile}>
            <Bone className="aspect-[3/4]" />
            <div className="mt-2 text-[0.875rem]">
              <TextBone className="w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
