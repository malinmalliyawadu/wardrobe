import type { Guide } from '../src/lib/style-guide.ts'
import type { SlotDraft } from '../src/lib/blueprint.ts'
import type { Profile } from '../src/lib/profile.ts'

/** Shared fixtures for the style guide and blueprint tests. */

export const guideFixture: Guide = {
  palette: {
    summary: 'Deep and warm.',
    best: [
      { hex: '#7a2e1f', name: 'oxblood', use: 'knitwear' },
      { hex: '#2f4a3a', name: 'pine', use: 'overshirts' },
    ],
    neutrals: [{ hex: '#33221a', name: 'dark chocolate', use: 'trousers' }],
    avoid: [{ hex: '#ffc0cb', name: 'pastel pink', why: 'washes you out' }],
    metal: 'gold',
    metal_why: 'Warm undertone.',
  },
  silhouette: { summary: 'Keep the line long.', rules: [{ topic: 'Trouser rise', rule: 'Mid to high rise.' }] },
  shoes: { summary: 'Low profile.', rules: [{ topic: 'Sole', rule: 'Slim soles.' }] },
  accessories: { summary: 'Mid scale.', rules: [{ topic: 'Watch', rule: '38 to 40 mm.' }] },
  fit_vocabulary: [{ garment: 'tee', fits: ['regular', 'slim'], note: 'Shoulder seam on the shoulder.' }],
}

export const draftFixture: SlotDraft = {
  name: 'Oxblood merino crew',
  why: 'Your strongest colour, near the face.',
  priority: 1,
  garment_type: 'knitwear',
  colour_family: 'oxblood',
  colours: ['#7A2E1F'],
  fabrics: ['merino'],
  fit: 'slim',
  sizes: { labels: ['S'], note: null },
  budget_nzd: { min: 150, max: 260 },
  status: 'wanted',
}

export const profileFixture: Profile = {
  height_cm: 168,
  undertone: 'warm',
  skin_depth: 'tan',
  hair_colour: 'black',
  hair_texture: null,
  eye_colour: 'dark brown',
  contrast_level: 'medium',
  season: 'deep autumn',
  season_confidence: 60,
  build: 'athletic',
  shoulder_hip: 'shoulders_wider',
  torso_leg: 'balanced',
  neck_length: 'average',
  sizes: { tee: 'S', chest_cm: null },
  fit_preferences: { tops: 'slim' },
  life: {},
  taste: {},
  budget: {},
  analysis: null,
  analysed_at: null,
  confirmed_at: new Date('2026-11-04'),
  updated_at: new Date('2026-11-04'),
}
