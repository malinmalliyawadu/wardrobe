import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
import { Bone, FormBones, FormSkeleton, Skeleton } from '@/components/skeleton'
import { RULE_SECTIONS, getGuide, isRuleSection } from '@/lib/style-guide'

import { NoGuide } from '../no-guide'
import { SECTION_INTROS, SECTION_TITLES } from '../titles'
import { SectionForm } from './form'

export function generateStaticParams() {
  return RULE_SECTIONS.map((section) => ({ section }))
}

export async function generateMetadata({ params }: PageProps<'/blueprint/guide/[section]'>): Promise<Metadata> {
  const { section } = await params
  return { title: isRuleSection(section) ? `Edit ${SECTION_TITLES[section].toLowerCase()}` : 'Style guide' }
}

export default function SectionPage({ params }: PageProps<'/blueprint/guide/[section]'>) {
  return (
    <section>
      <BackLink href="/blueprint/guide" label="Style guide" />
      <Suspense
        fallback={
          <Skeleton label="Loading the section">
            <div className="mt-3 text-[2rem] sm:text-[2.5rem]">
              <span className="flex h-[1em] items-center">
                <Bone className="h-[0.7em] w-2/3 rounded-[2px]" />
              </span>
            </div>
            <FormBones />
          </Skeleton>
        }
      >
        <Header params={params} />
      </Suspense>
    </section>
  )
}

/** The section comes from the URL, so the heading streams with it. */
async function Header({ params }: Pick<PageProps<'/blueprint/guide/[section]'>, 'params'>) {
  const { section } = await params
  if (!isRuleSection(section)) notFound()
  return (
    <>
      <h1 className="headline mt-3 text-[2rem] sm:text-[2.5rem]">{SECTION_TITLES[section]}</h1>
      <p className="prose mt-3 max-w-[44ch] text-[0.9375rem] leading-normal text-ink-2">{SECTION_INTROS[section]}</p>
      <Suspense fallback={<FormSkeleton />}>
        <Loaded section={section} />
      </Suspense>
    </>
  )
}

async function Loaded({ section }: { section: (typeof RULE_SECTIONS)[number] }) {
  await connection()
  const guide = await getGuide()
  if (!guide) return <NoGuide />
  return <SectionForm key={guide.edited_at?.toISOString() ?? 'drafted'} name={section} section={guide[section]} />
}
