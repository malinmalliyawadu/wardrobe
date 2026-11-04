import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { BackLink } from '@/components/back-link'
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
      <Suspense fallback={<p className="mt-6 text-ink-3">Loading</p>}>
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
      <h1 className="mt-2 font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] sm:text-[2.75rem]">
        {SECTION_TITLES[section]}
      </h1>
      <p className="mt-4 max-w-[40ch] text-[1.0625rem] leading-relaxed text-ink-2">{SECTION_INTROS[section]}</p>
      <Suspense fallback={<p className="mt-8 text-ink-3">Loading</p>}>
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
