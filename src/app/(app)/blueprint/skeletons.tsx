import { Bone, FormBones, Skeleton, SlotRowSkeleton, TextBone } from '@/components/skeleton'

/* The Blueprint tab's pages while they stream, each in the shape of what lands. */

function SectionHeading({ width = 'w-36' }: { width?: string }) {
  return (
    <span className="flex h-[2.05rem] items-center text-[1.625rem]">
      <Bone className={`h-[0.7em] rounded-full ${width}`} />
    </span>
  )
}

/** The guide row, the overview line, then the first priority group's slots. */
export function BlueprintSkeleton() {
  return (
    <Skeleton label="Loading the blueprint">
      <div className="mt-8 flex min-h-16 items-center gap-4 border-y border-line py-3">
        <div className="flex-1">
          <TextBone className="w-24" />
          <div className="mt-0.5 text-sm">
            <TextBone className="w-56 max-w-full" />
          </div>
        </div>
        <div className="flex shrink-0 -space-x-1.5">
          {[0, 1, 2, 3, 4].map((swatch) => (
            <Bone key={swatch} className="h-8 w-5 rounded-[0.25rem]" />
          ))}
        </div>
      </div>
      <div className="mt-10 max-w-[34ch] text-[1.375rem]">
        <TextBone className="w-full" />
        <TextBone className="w-3/5" />
      </div>
      <div className="mt-14 border-b border-line pb-3">
        <SectionHeading width="w-28" />
        <div className="mt-1 text-sm">
          <TextBone className="w-64 max-w-full" />
          <TextBone className="w-44" />
        </div>
      </div>
      <div className="divide-y divide-line">
        {[0, 1, 2, 3].map((row) => (
          <SlotRowSkeleton key={row} />
        ))}
      </div>
    </Skeleton>
  )
}

/** A slot: name and swatches, the why, the status control, then its details form. */
export function SlotSkeleton() {
  return (
    <Skeleton label="Loading the slot">
      <div className="mt-2 flex items-start gap-4">
        <div className="min-w-0 flex-1 text-[2.25rem] sm:text-[2.75rem]">
          <span className="flex h-[1.05em] items-center">
            <Bone className="h-[0.7em] w-4/5 rounded-full" />
          </span>
        </div>
        <Bone className="mt-1 h-14 w-14 shrink-0 rounded-lg" />
      </div>
      <div className="mt-4 max-w-[42ch] text-[1.0625rem]">
        <TextBone className="w-full" />
        <TextBone className="w-full" />
        <TextBone className="w-2/3" />
      </div>
      <div className="mt-8 border-t border-line pt-6">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((pill) => (
            <Bone key={pill} className="h-10 w-20 rounded-full" />
          ))}
        </div>
      </div>
      <div className="mt-12 border-t border-line pt-6">
        <SectionHeading width="w-24" />
      </div>
      <FormBones fields={3} />
    </Skeleton>
  )
}

/** The guide: its palette part, with the best colours as a grid of swatches. */
export function GuideSkeleton() {
  return (
    <Skeleton label="Loading the guide">
      <div className="mt-10 border-b border-line pb-3">
        <SectionHeading width="w-24" />
      </div>
      <div className="mt-4 max-w-[46ch] text-[1.1875rem]">
        <TextBone className="w-full" />
        <TextBone className="w-full" />
        <TextBone className="w-1/2" />
      </div>
      <div className="mt-10 text-sm">
        <TextBone className="w-24" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index}>
            <Bone className="aspect-[4/5] w-full rounded-[0.5rem]" />
            <div className="mt-2 text-[0.9375rem]">
              <TextBone className="w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
