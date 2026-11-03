import type { Season } from './profile-values.ts'

export type SeasonInfo = {
  family: 'spring' | 'summer' | 'autumn' | 'winter'
  /** One sentence for Malin, written as a stylist would say it. */
  traits: string
  metal: 'gold' | 'silver' | 'mixed'
  /** Six representative colours. The style guide (M2) refines these. */
  swatches: [string, string, string, string, string, string]
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
    swatches: ['#ff5c39', '#ffd23f', '#00a896', '#2e6bd6', '#f4f1ea', '#1f2a44'],
  },
  'true spring': {
    family: 'spring',
    traits: 'Warm and clear. Golden tan, bright coral, grass green and warm turquoise.',
    metal: 'gold',
    swatches: ['#f28c38', '#f9d84a', '#4fb286', '#2a9df4', '#f5e3c3', '#7a4e2d'],
  },
  'light spring': {
    family: 'spring',
    traits: 'Warm and light with gentle contrast. Peach, light camel, soft aqua and warm ivory.',
    metal: 'gold',
    swatches: ['#f6d6c4', '#f7b267', '#9ad1d4', '#b8e0a5', '#fff1b8', '#6b8e9b'],
  },
  'light summer': {
    family: 'summer',
    traits: 'Cool and light with low contrast. Powder blue, rose, soft mint and light grey.',
    metal: 'silver',
    swatches: ['#dfe7f2', '#b7c9e2', '#e6b8c6', '#a8d5ba', '#f2f2f0', '#6d7f99'],
  },
  'true summer': {
    family: 'summer',
    traits: 'Cool and soft. Dusty blue, raspberry, sage and lavender grey.',
    metal: 'silver',
    swatches: ['#6f8fbf', '#b56b8a', '#8fb3a6', '#d9d2e9', '#e9e6e1', '#3f4c6b'],
  },
  'soft summer': {
    family: 'summer',
    traits: 'Cool, muted and low contrast. Slate, mauve, sage and stone.',
    metal: 'silver',
    swatches: ['#9aa6b2', '#a88d9c', '#8c9c8a', '#c9b9b0', '#e6e2dc', '#4a5159'],
  },
  'soft autumn': {
    family: 'autumn',
    traits: 'Warm and muted. Camel, olive, terracotta and mushroom.',
    metal: 'gold',
    swatches: ['#b89b7a', '#a3a47a', '#c7866b', '#8f8f6b', '#e8dfcf', '#5b4a3f'],
  },
  'true autumn': {
    family: 'autumn',
    traits: 'Warm and rich. Rust, moss, tomato red and forest green.',
    metal: 'gold',
    swatches: ['#b5651d', '#7a6f1f', '#c93c20', '#3d5a40', '#e2c391', '#3b2a20'],
  },
  'deep autumn': {
    family: 'autumn',
    traits: 'Warm and deep with high contrast. Burgundy, pine, bronze and ink navy.',
    metal: 'mixed',
    swatches: ['#7a2e1f', '#2f4a3a', '#8a6a1f', '#3b3a7a', '#d9c3a5', '#1f1a17'],
  },
  'deep winter': {
    family: 'winter',
    traits: 'Cool and deep. Navy, oxblood, pine and black with a pure white.',
    metal: 'silver',
    swatches: ['#1b1f3b', '#5c0f2b', '#0f5c4f', '#c9c5bf', '#f2f2f2', '#121212'],
  },
  'true winter': {
    family: 'winter',
    traits: 'Cool and clear with high contrast. True red, royal blue, emerald, black and white.',
    metal: 'silver',
    swatches: ['#0a2a66', '#b30838', '#007a5c', '#7b3fa0', '#f5f5f5', '#101010'],
  },
  'bright winter': {
    family: 'winter',
    traits: 'Cool and bright. Cobalt, hot pink, turquoise and icy white.',
    metal: 'silver',
    swatches: ['#1b4fff', '#ff2d6f', '#00c2a8', '#f7ec1f', '#ffffff', '#0b0b0b'],
  },
}

/** "deep autumn" -> "Deep Autumn" */
export function seasonName(season: Season): string {
  return season.replace(/\b\w/g, (c) => c.toUpperCase())
}
