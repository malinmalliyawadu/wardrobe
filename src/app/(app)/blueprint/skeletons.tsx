import { Bone, FormBones, Skeleton, SlotRowSkeleton, TextBone } from '@/components/skeleton'

/* The Blueprint tab's pages while they stream, each in the shape of what lands. */

/** The caption-and-aside line a section opens with. */
function HeadBones({ width = 'w-20', aside = true }: { width?: string; aside?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <TextBone className={width} size="text-[0.8125rem]" />
      {aside ? <TextBone className="w-32" size="text-[0.8125rem]" /> : null}
    </div>
  )
}

/** The palette band, its caption, the overview line, then the first priority's slots. */
export function BlueprintSkeleton() {
  return (
    <Skeleton label="Loading the blueprint" className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
      <div>
        <div className="mt-2">
          <div className="bleed lg:mx-0">
            <Bone className="h-16 rounded-none! lg:h-[8.125rem] lg:rounded-[var(--radius-tile)]!" />
          </div>
          <div className="mt-2 flex min-h-11 items-center justify-between gap-4">
            <TextBone className="w-44" size="text-[0.8125rem]" />
            <TextBone className="w-10" size="text-[0.9375rem]" />
          </div>
        </div>
        <div className="mt-10 text-[2.5rem] sm:text-[3.25rem]">
          <span className="flex h-[0.94em] items-center">
            <Bone className="h-[0.68em] w-4/5 rounded-[2px]" />
          </span>
        </div>
        <div className="mt-3 text-[1.0625rem]">
          <TextBone className="w-3/4" />
        </div>
      </div>
      <div className="max-w-3xl">
        <div className="mt-14 lg:mt-0">
          <HeadBones />
          <TextBone className="w-64 max-w-full" size="text-[0.8125rem]" />
        </div>
        <div className="mt-2 divide-y divide-line">
          {[0, 1, 2, 3].map((row) => (
            <SlotRowSkeleton key={row} />
          ))}
        </div>
      </div>
    </Skeleton>
  )
}

/** A slot: swatches beside its name, the why, the facts, the status, then its details form. */
export function SlotSkeleton() {
  return (
    <Skeleton label="Loading the slot" className="mt-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
      <div>
        <div className="flex items-start gap-4 lg:flex-col lg:gap-5">
          <Bone className="h-16 w-16 shrink-0" />
          <div className="min-w-0 flex-1 text-[2rem] sm:text-[2.5rem] lg:w-full lg:text-[2rem]">
            <span className="flex h-[0.94em] items-center">
              <Bone className="h-[0.68em] w-4/5 rounded-[2px]" />
            </span>
            <span className="flex h-[0.94em] items-center">
              <Bone className="h-[0.68em] w-2/5 rounded-[2px]" />
            </span>
          </div>
        </div>
        <div className="mt-5 max-w-[44ch] text-[1.0625rem]">
          <TextBone className="w-full" />
          <TextBone className="w-full" />
          <TextBone className="w-2/3" />
        </div>
        <TextBone className="mt-3 w-56" size="text-sm" />
        <div className="mt-10">
          <TextBone className="w-12" size="text-sm" />
          <div className="mt-2 grid grid-cols-4 gap-1.5 sm:flex sm:gap-2 lg:grid">
            {[0, 1, 2, 3].map((segment) => (
              <Bone key={segment} className="h-11 rounded-[var(--radius-control)] sm:w-24 lg:w-auto" />
            ))}
          </div>
          <TextBone className="mt-2 w-64 max-w-full" size="text-sm" />
        </div>
      </div>
      <div className="mt-12 max-w-2xl lg:mt-0">
        <HeadBones width="w-14" aside={false} />
        <TextBone className="w-72 max-w-full" size="text-[0.8125rem]" />
        <FormBones fields={3} />
      </div>
    </Skeleton>
  )
}

/** The guide: its palette part, with the best colours as a grid of swatches. */
export function GuideSkeleton() {
  return (
    <Skeleton label="Loading the guide">
      <div className="mt-4">
        <HeadBones width="w-16" />
      </div>
      <div className="mt-3 max-w-[60ch] text-[1.0625rem]">
        <TextBone className="w-full" />
        <TextBone className="w-full" />
        <TextBone className="w-1/2" />
      </div>
      <TextBone className="mt-8 w-24" size="text-[0.8125rem]" />
      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index}>
            <Bone className="aspect-[4/5] w-full" />
            <TextBone className="mt-1.5 w-2/3" size="text-[0.9375rem]" />
            <TextBone className="w-4/5" size="text-sm" />
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
