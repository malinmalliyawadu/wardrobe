import type { ReactNode } from 'react'

/*
 * What a page shows while its data streams in: the shape of what is coming,
 * in the surface colour, so nothing jumps when it lands. A skeleton stays
 * invisible for its first 300 ms (`.skeleton` in globals.css), so a quick
 * load shows nothing at all rather than a flash of grey. Static: no shimmer.
 */

/** One placeholder: a line of text, a heading, a photo. */
export function Bone({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`bone block rounded-[var(--radius-tile)] ${className}`} />
}

/** Wraps a fallback, and tells a screen reader what is loading. */
export function Skeleton({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={label} aria-busy className={`skeleton ${className}`}>
      {children}
    </div>
  )
}

/** A line of text at body size: the bone is shorter than the line, as a glyph's x-height is. */
export function TextBone({ className = '', size = '' }: { className?: string; size?: string }) {
  return (
    <span aria-hidden className={`flex h-[1.5em] items-center ${size}`}>
      <Bone className={`h-[0.7em] rounded-[2px] ${className}`} />
    </span>
  )
}

/** Labelled fields, for the forms under You and the guide. */
export function FormSkeleton({ fields = 3, label = 'Loading the form' }: { fields?: number; label?: string }) {
  return (
    <Skeleton label={label}>
      <FormBones fields={fields} />
    </Skeleton>
  )
}

/** The fields alone, for a skeleton that already has its own wrapper. */
export function FormBones({ fields = 3 }: { fields?: number }) {
  return (
    <div className="mt-8 grid gap-6">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index}>
          <Bone className="mb-2.5 h-3.5 w-28 rounded-[2px]" />
          <Bone className="h-12 rounded-[var(--radius-control)]" />
        </div>
      ))}
      <Bone className="mt-2 h-12 w-32 rounded-[var(--radius-control)]" />
    </div>
  )
}

/** A blueprint slot row: the colour block, a name, a why, a status. */
export function SlotRowSkeleton() {
  return (
    <div className="flex gap-3 py-4">
      <Bone className="h-11 w-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="flex h-[1.5rem] items-center text-[1.125rem]">
          <Bone className="h-[0.75em] w-3/5 rounded-[2px]" />
        </span>
        <div className="mt-1 text-[0.9375rem]">
          <TextBone className="w-full" />
          <TextBone className="w-4/5" />
        </div>
        <div className="mt-2 text-sm">
          <TextBone className="w-28" />
        </div>
      </div>
    </div>
  )
}

/** The heading and line a page streams in when they come from the URL. */
export function TitleSkeleton() {
  return (
    <>
      <div className="mt-3 text-[2rem] sm:text-[2.5rem]">
        <span className="flex h-[1em] items-center">
          <Bone className="h-[0.7em] w-2/3 rounded-[2px]" />
        </span>
      </div>
      <div className="mt-3 max-w-[44ch] text-[0.9375rem]">
        <TextBone className="w-full" />
        <TextBone className="w-1/2" />
      </div>
    </>
  )
}

/** The photo sections: a title, a hint and a row of portrait tiles each. */
export function PhotosSkeleton() {
  return (
    <Skeleton label="Loading your photos">
      {[2, 2, 3].map((tiles, section) => (
        <div key={section} className="mt-10">
          <TextBone className="w-20" size="text-sm" />
          <TextBone className="w-64 max-w-full" size="text-sm" />
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: tiles }, (_, index) => (
              <Bone key={index} className="aspect-[3/4] w-full" />
            ))}
          </div>
        </div>
      ))}
    </Skeleton>
  )
}
