import type { Slot } from '@/lib/blueprint'
import { dollars } from '@/lib/blueprint'
import type { Profile } from '@/lib/profile'
import type { StoredGuide } from '@/lib/style-guide'

import type { SlotFormValues } from './slot-form'

/** What the slot form starts from: a saved slot, or a blank one. */
export function formValues(slot: Slot | null): SlotFormValues {
  return {
    name: slot?.name ?? '',
    why: slot?.why ?? '',
    priority: slot?.priority ?? 2,
    garment_type: slot?.garment_type ?? '',
    colour_family: slot?.colour_family ?? '',
    colours: slot?.colours ?? [],
    fabrics: slot?.fabrics.join(', ') ?? '',
    fit: slot?.fit ?? '',
    size_labels: slot?.sizes.labels?.join(', ') ?? '',
    size_note: slot?.sizes.note ?? '',
    budget_min: dollars(slot?.budget_min_cents ?? null),
    budget_max: dollars(slot?.budget_max_cents ?? null),
  }
}

export function paletteSwatches(guide: StoredGuide | null) {
  return {
    best: guide?.palette.best.map(({ hex, name }) => ({ hex, name })) ?? [],
    neutrals: guide?.palette.neutrals.map(({ hex, name }) => ({ hex, name })) ?? [],
  }
}

export function ceilings(profile: Profile): Record<string, number | null | undefined> {
  return { ...profile.budget }
}
