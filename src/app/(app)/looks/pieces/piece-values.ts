import type { PieceValues } from '@/lib/pieces'
import type { StoredGuide } from '@/lib/style-guide'

/* What the piece form needs, prepared on the server. */

export type Swatch = { hex: string; name: string }

export type PieceFormValues = {
  name: string
  garment_type: string
  colour_hex: string
  colour_name: string
  fabric: string
  fit: string
  warmth: string
  worn_for: string
  brand: string
  size: string
  notes: string
  slot_id: string
}

export function formValues(values: Partial<PieceValues>): PieceFormValues {
  return {
    name: values.name ?? '',
    garment_type: values.garment_type ?? '',
    colour_hex: values.colour_hex ?? '',
    colour_name: values.colour_name ?? '',
    fabric: values.fabric ?? '',
    fit: values.fit ?? '',
    warmth: values.warmth ?? '',
    worn_for: values.worn_for ?? 'everyday',
    brand: values.brand ?? '',
    size: values.size ?? '',
    notes: values.notes ?? '',
    slot_id: values.slot_id ? String(values.slot_id) : '',
  }
}


/** The guide's palette as the form's swatches. */
export function paletteSwatches(guide: StoredGuide | null): { best: Swatch[]; neutrals: Swatch[] } {
  if (!guide) return { best: [], neutrals: [] }
  const swatch = (colour: { hex: string; name: string }) => ({ hex: colour.hex, name: colour.name })
  return { best: guide.palette.best.map(swatch), neutrals: guide.palette.neutrals.map(swatch) }
}
