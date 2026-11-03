'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { ANALYSIS_KINDS, AnalysisError, analysePhotos } from '@/lib/analysis'
import { listPhotos, photoBase64, PHOTO_KINDS, PhotoError, removeAllPhotos, removePhoto, storePhoto, type PhotoKind } from '@/lib/photos'
import {
  confirmColouring,
  getProfile,
  parseBudgetForm,
  parseColouringForm,
  parseLifeForm,
  parseSizesForm,
  parseTasteForm,
  saveAnalysis,
  saveBudget,
  saveLife,
  saveSizes,
  saveTaste,
} from '@/lib/profile'
import { parseStoredAnalysis } from '@/lib/analysis'

export type ActionState = {
  ok: boolean
  message?: string
  errors?: Record<string, string>
  /**
   * What was submitted, echoed back on a validation error. React 19 resets a
   * form once its action returns, so without this every other field would be
   * wiped while the user fixes the one that was wrong.
   */
  values?: Record<string, string>
} | null

function echo(form: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') values[key] = value
  }
  return values
}

/** Every profile mutation touches Today and the hub, so refresh the tree. */
function refreshAll(): void {
  revalidatePath('/', 'layout')
}

export async function uploadPhoto(_prev: ActionState, form: FormData): Promise<ActionState> {
  const file = form.get('file')
  const kind = form.get('kind')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a photo first.' }
  }
  if (typeof kind !== 'string' || !(PHOTO_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: 'Unknown photo kind.' }
  }
  try {
    await storePhoto({
      bytes: Buffer.from(await file.arrayBuffer()),
      mime: file.type,
      kind: kind as PhotoKind,
    })
  } catch (error) {
    if (error instanceof PhotoError) return { ok: false, message: error.message }
    throw error
  }
  refreshAll()
  return { ok: true }
}

export async function deletePhoto(form: FormData): Promise<void> {
  const id = Number(form.get('id'))
  if (Number.isInteger(id)) await removePhoto(id)
  refreshAll()
}

export async function deleteAllPhotos(): Promise<void> {
  await removeAllPhotos()
  refreshAll()
}

export async function runAnalysis(): Promise<ActionState> {
  const [profile, photos] = await Promise.all([getProfile(), listPhotos()])
  const chosen = photos.filter((photo) => ANALYSIS_KINDS.includes(photo.kind))
  try {
    const payload = await Promise.all(
      chosen.map(async (photo) => ({ id: photo.id, kind: photo.kind, base64: await photoBase64(photo) })),
    )
    const analysis = await analysePhotos(payload, profile.height_cm)
    await saveAnalysis(analysis)
  } catch (error) {
    if (error instanceof AnalysisError) return { ok: false, message: error.message }
    throw error
  }
  refreshAll()
  redirect('/you/colouring')
}

export async function submitColouring(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseColouringForm(form)
  if (!parsed.ok) return { ok: false, errors: parsed.errors, values: echo(form) }

  // Claude's confidence only describes Claude's own pick. If Malin overrides
  // the season, the number no longer applies.
  const profile = await getProfile()
  const proposal = parseStoredAnalysis(profile.analysis)
  const confidence =
    proposal && proposal.colouring.season.value === parsed.data.season
      ? proposal.colouring.season.confidence
      : null

  await confirmColouring({ ...parsed.data, season_confidence: confidence })
  refreshAll()
  redirect('/you')
}

export async function submitSizes(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseSizesForm(form)
  if (!parsed.ok) return { ok: false, errors: parsed.errors, values: echo(form) }
  await saveSizes(parsed.data.height_cm, parsed.data.sizes, parsed.data.fits)
  refreshAll()
  redirect('/you')
}

export async function submitLife(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseLifeForm(form)
  if (!parsed.ok) return { ok: false, errors: parsed.errors, values: echo(form) }
  await saveLife(parsed.data)
  refreshAll()
  redirect('/you')
}

export async function submitTaste(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseTasteForm(form)
  if (!parsed.ok) return { ok: false, errors: parsed.errors, values: echo(form) }
  await saveTaste(parsed.data)
  refreshAll()
  redirect('/you')
}

export async function submitBudget(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseBudgetForm(form)
  if (!parsed.ok) return { ok: false, errors: parsed.errors, values: echo(form) }
  await saveBudget(parsed.data)
  refreshAll()
  redirect('/you')
}
