import type { Season } from './profile-values.ts'

/** Named in lower case, as the style guide names its colours. */
export type SeasonSwatch = { hex: string; name: string }

export type SeasonInfo = {
  family: 'spring' | 'summer' | 'autumn' | 'winter'
  /** One sentence for Malin, written as a stylist would say it. */
  traits: string
  metal: 'gold' | 'silver' | 'mixed'
  /** Six representative colours, named. The style guide (M2) refines these. */
  swatches: [SeasonSwatch, SeasonSwatch, SeasonSwatch, SeasonSwatch, SeasonSwatch, SeasonSwatch]
}

/**
 * The twelve-season system. Representative colours only; they drive the
 * swatch fan on Today and give the confirm screen something to look at. The
 * full palette with best neutrals and colours to avoid is generated in M2.
 */
export const SEASON_INFO: Record<Season, SeasonInfo> = {
  'bright spring': {
    family: 'spring',
    traits: 'Warm and bright with high contrast. Hot coral, lemon, emerald and electric blue against a clean white.',
    metal: 'gold',
    swatches: [
      { hex: '#ff5c39', name: 'hot coral' },
      { hex: '#ffd23f', name: 'lemon' },
      { hex: '#00a896', name: 'emerald' },
      { hex: '#2e6bd6', name: 'electric blue' },
      { hex: '#f4f1ea', name: 'clean white' },
      { hex: '#1f2a44', name: 'navy' },
    ],
  },
  'true spring': {
    family: 'spring',
    traits: 'Warm and clear. Golden tan, bright coral, grass green and warm turquoise.',
    metal: 'gold',
    swatches: [
      { hex: '#f28c38', name: 'tangerine' },
      { hex: '#f9d84a', name: 'daffodil' },
      { hex: '#4fb286', name: 'grass green' },
      { hex: '#2a9df4', name: 'warm turquoise' },
      { hex: '#f5e3c3', name: 'cream' },
      { hex: '#7a4e2d', name: 'golden brown' },
    ],
  },
  'light spring': {
    family: 'spring',
    traits: 'Warm and light with gentle contrast. Peach, light camel, soft aqua and warm ivory.',
    metal: 'gold',
    swatches: [
      { hex: '#f6d6c4', name: 'peach' },
      { hex: '#f7b267', name: 'apricot' },
      { hex: '#9ad1d4', name: 'soft aqua' },
      { hex: '#b8e0a5', name: 'light green' },
      { hex: '#fff1b8', name: 'warm ivory' },
      { hex: '#6b8e9b', name: 'soft teal' },
    ],
  },
  'light summer': {
    family: 'summer',
    traits: 'Cool and light with low contrast. Powder blue, rose, soft mint and light grey.',
    metal: 'silver',
    swatches: [
      { hex: '#dfe7f2', name: 'ice blue' },
      { hex: '#b7c9e2', name: 'powder blue' },
      { hex: '#e6b8c6', name: 'rose' },
      { hex: '#a8d5ba', name: 'soft mint' },
      { hex: '#f2f2f0', name: 'soft white' },
      { hex: '#6d7f99', name: 'blue grey' },
    ],
  },
  'true summer': {
    family: 'summer',
    traits: 'Cool and soft. Dusty blue, raspberry, sage and lavender grey.',
    metal: 'silver',
    swatches: [
      { hex: '#6f8fbf', name: 'dusty blue' },
      { hex: '#b56b8a', name: 'raspberry' },
      { hex: '#8fb3a6', name: 'sage' },
      { hex: '#d9d2e9', name: 'lavender' },
      { hex: '#e9e6e1', name: 'soft white' },
      { hex: '#3f4c6b', name: 'slate navy' },
    ],
  },
  'soft summer': {
    family: 'summer',
    traits: 'Cool, muted and low contrast. Slate, mauve, sage and stone.',
    metal: 'silver',
    swatches: [
      { hex: '#9aa6b2', name: 'slate' },
      { hex: '#a88d9c', name: 'mauve' },
      { hex: '#8c9c8a', name: 'sage' },
      { hex: '#c9b9b0', name: 'rose taupe' },
      { hex: '#e6e2dc', name: 'stone' },
      { hex: '#4a5159', name: 'charcoal' },
    ],
  },
  'soft autumn': {
    family: 'autumn',
    traits: 'Warm and muted. Camel, olive, terracotta and mushroom.',
    metal: 'gold',
    swatches: [
      { hex: '#b89b7a', name: 'camel' },
      { hex: '#a3a47a', name: 'soft olive' },
      { hex: '#c7866b', name: 'terracotta' },
      { hex: '#8f8f6b', name: 'khaki' },
      { hex: '#e8dfcf', name: 'oatmeal' },
      { hex: '#5b4a3f', name: 'cocoa' },
    ],
  },
  'true autumn': {
    family: 'autumn',
    traits: 'Warm and rich. Rust, moss, tomato red and forest green.',
    metal: 'gold',
    swatches: [
      { hex: '#b5651d', name: 'rust' },
      { hex: '#7a6f1f', name: 'moss' },
      { hex: '#c93c20', name: 'tomato red' },
      { hex: '#3d5a40', name: 'forest green' },
      { hex: '#e2c391', name: 'wheat' },
      { hex: '#3b2a20', name: 'chocolate' },
    ],
  },
  'deep autumn': {
    family: 'autumn',
    traits: 'Deep and warm, rich rather than stark. Burgundy, pine, bronze, deep teal and dark chocolate.',
    metal: 'gold',
    swatches: [
      { hex: '#7a2e1f', name: 'brick' },
      { hex: '#2f4a3a', name: 'pine' },
      { hex: '#8a6a1f', name: 'bronze' },
      { hex: '#1f4f57', name: 'deep teal' },
      { hex: '#d9c3a5', name: 'sand' },
      { hex: '#33221a', name: 'dark chocolate' },
    ],
  },
  'deep winter': {
    family: 'winter',
    traits: 'Cool and deep. Navy, oxblood, pine and black with a pure white.',
    metal: 'silver',
    swatches: [
      { hex: '#1b1f3b', name: 'navy' },
      { hex: '#5c0f2b', name: 'oxblood' },
      { hex: '#0f5c4f', name: 'pine' },
      { hex: '#c9c5bf', name: 'cool grey' },
      { hex: '#f2f2f2', name: 'pure white' },
      { hex: '#121212', name: 'black' },
    ],
  },
  'true winter': {
    family: 'winter',
    traits: 'Cool and clear with high contrast. True red, royal blue, emerald, black and white.',
    metal: 'silver',
    swatches: [
      { hex: '#0a2a66', name: 'royal blue' },
      { hex: '#b30838', name: 'true red' },
      { hex: '#007a5c', name: 'emerald' },
      { hex: '#7b3fa0', name: 'purple' },
      { hex: '#f5f5f5', name: 'white' },
      { hex: '#101010', name: 'black' },
    ],
  },
  'bright winter': {
    family: 'winter',
    traits: 'Cool and bright. Cobalt, hot pink, turquoise and icy white.',
    metal: 'silver',
    swatches: [
      { hex: '#1b4fff', name: 'cobalt' },
      { hex: '#ff2d6f', name: 'hot pink' },
      { hex: '#00c2a8', name: 'turquoise' },
      { hex: '#f7ec1f', name: 'lemon' },
      { hex: '#ffffff', name: 'icy white' },
      { hex: '#0b0b0b', name: 'black' },
    ],
  },
}

/** "deep autumn" -> "Deep Autumn" */
export function seasonName(season: Season): string {
  return season.replace(/\b\w/g, (c) => c.toUpperCase())
}
