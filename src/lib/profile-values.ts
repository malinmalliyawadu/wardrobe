/**
 * The closed vocabularies of the profile, shared by the schema, Claude's
 * output format and the confirm form. The database check constraints in
 * db/migrations/0001_core_schema.sql list the same values.
 */

export const UNDERTONES = ['warm', 'cool', 'neutral', 'olive'] as const
export const SKIN_DEPTHS = ['fair', 'light', 'medium', 'tan', 'deep'] as const
export const CONTRAST_LEVELS = ['low', 'medium', 'high'] as const
export const BUILDS = ['slim', 'athletic', 'broad'] as const
export const SHOULDER_HIP = ['shoulders_wider', 'balanced', 'hips_wider'] as const
export const TORSO_LEG = ['long_torso', 'balanced', 'long_legs'] as const
export const NECK_LENGTHS = ['short', 'average', 'long'] as const
export const SEASONS = [
  'bright spring',
  'true spring',
  'light spring',
  'light summer',
  'true summer',
  'soft summer',
  'soft autumn',
  'true autumn',
  'deep autumn',
  'deep winter',
  'true winter',
  'bright winter',
] as const
export const FITS = ['slim', 'regular', 'relaxed', 'oversized'] as const

/** The days of the week, Monday first, as Life stores the days he trains. */
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

/** The weekday of a YYYY-MM-DD date. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!
}
export const TEE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const

export type Undertone = (typeof UNDERTONES)[number]
export type SkinDepth = (typeof SKIN_DEPTHS)[number]
export type ContrastLevel = (typeof CONTRAST_LEVELS)[number]
export type Build = (typeof BUILDS)[number]
export type ShoulderHip = (typeof SHOULDER_HIP)[number]
export type TorsoLeg = (typeof TORSO_LEG)[number]
export type NeckLength = (typeof NECK_LENGTHS)[number]
export type Season = (typeof SEASONS)[number]
export type Fit = (typeof FITS)[number]
export type TeeSize = (typeof TEE_SIZES)[number]

/** Human labels for the snake_case values. */
export const LABELS: Record<string, string> = {
  warm: 'Warm',
  cool: 'Cool',
  neutral: 'Neutral',
  olive: 'Olive',
  fair: 'Fair',
  light: 'Light',
  medium: 'Medium',
  tan: 'Tan',
  deep: 'Deep',
  low: 'Low',
  high: 'High',
  slim: 'Slim',
  athletic: 'Athletic',
  broad: 'Broad',
  shoulders_wider: 'Shoulders wider than hips',
  balanced: 'Balanced',
  hips_wider: 'Hips wider than shoulders',
  long_torso: 'Longer torso',
  long_legs: 'Longer legs',
  short: 'Short',
  average: 'Average',
  long: 'Long',
  regular: 'Regular',
  relaxed: 'Relaxed',
  oversized: 'Oversized',
}

export function label(value: string): string {
  return LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1)
}
