import { z } from 'zod'

import { db } from './db.ts'
import { finish, number, text, type ParseResult } from './form-parse.ts'
import {
  BUILDS,
  CONTRAST_LEVELS,
  FITS,
  NECK_LENGTHS,
  SEASONS,
  SHOULDER_HIP,
  SKIN_DEPTHS,
  TEE_SIZES,
  TORSO_LEG,
  UNDERTONES,
  WEEKDAYS,
  type Build,
  type ContrastLevel,
  type NeckLength,
  type Season,
  type ShoulderHip,
  type SkinDepth,
  type TorsoLeg,
  type Undertone,
} from './profile-values.ts'

/*
 * The typed-in groups, stored as jsonb. The shapes are validated here, at the
 * edge, rather than in the database, because they will change as the forms do.
 * Every field is nullable so a half-filled form is still a valid save.
 */

const cm = z.number().min(20).max(300).nullable()
const nzd = z.number().int().min(0).max(100_000).nullable()
const days = z.number().min(0).max(7).nullable()

export const SizesSchema = z.object({
  tee: z.enum(TEE_SIZES).nullable(),
  chest_cm: cm,
  waist_cm: cm,
  hips_cm: cm,
  inseam_cm: cm,
  sleeve_cm: cm,
  neck_cm: cm,
  shoe_eu: z.number().min(35).max(55).nullable(),
  shoe_uk: z.number().min(3).max(16).nullable(),
  shoe_us: z.number().min(4).max(17).nullable(),
})

export const FitsSchema = z.object({
  tops: z.enum(FITS).nullable(),
  knits: z.enum(FITS).nullable(),
  trousers: z.enum(FITS).nullable(),
  outerwear: z.enum(FITS).nullable(),
})

export const LifeSchema = z.object({
  /** Rough days per week in each context. */
  office: days,
  gym: days,
  /** The days he trains, so Today can give him a gym fit on them. gym is how many there are. */
  gym_days: z.array(z.enum(WEEKDAYS)).nullable(),
  running: days,
  evenings_out: days,
  travel: z.enum(['rarely', 'a_few_times_a_year', 'monthly']).nullable(),
  notes: z.string().max(2000).nullable(),
})

export const TasteSchema = z.object({
  references: z.string().max(4000).nullable(),
  no_gos: z.string().max(2000).nullable(),
  owned: z.string().max(4000).nullable(),
})

export const BudgetSchema = z.object({
  tees: nzd,
  shirts: nzd,
  knits: nzd,
  trousers: nzd,
  outerwear: nzd,
  shoes: nzd,
  accessories: nzd,
  monthly: nzd,
})

export type Sizes = z.infer<typeof SizesSchema>
export type Fits = z.infer<typeof FitsSchema>
export type Life = z.infer<typeof LifeSchema>
export type Taste = z.infer<typeof TasteSchema>
export type Budget = z.infer<typeof BudgetSchema>

export const ColouringSchema = z.object({
  undertone: z.enum(UNDERTONES).nullable(),
  skin_depth: z.enum(SKIN_DEPTHS).nullable(),
  hair_colour: z.string().max(80).nullable(),
  hair_texture: z.string().max(80).nullable(),
  eye_colour: z.string().max(80).nullable(),
  contrast_level: z.enum(CONTRAST_LEVELS).nullable(),
  season: z.enum(SEASONS).nullable(),
  season_confidence: z.number().int().min(0).max(100).nullable(),
  build: z.enum(BUILDS).nullable(),
  shoulder_hip: z.enum(SHOULDER_HIP).nullable(),
  torso_leg: z.enum(TORSO_LEG).nullable(),
  neck_length: z.enum(NECK_LENGTHS).nullable(),
})

export type Colouring = z.infer<typeof ColouringSchema>

export type Profile = {
  height_cm: number | null
  undertone: Undertone | null
  skin_depth: SkinDepth | null
  hair_colour: string | null
  hair_texture: string | null
  eye_colour: string | null
  contrast_level: ContrastLevel | null
  season: Season | null
  season_confidence: number | null
  build: Build | null
  shoulder_hip: ShoulderHip | null
  torso_leg: TorsoLeg | null
  neck_length: NeckLength | null
  sizes: Partial<Sizes>
  fit_preferences: Partial<Fits>
  life: Partial<Life>
  taste: Partial<Taste>
  budget: Partial<Budget>
  analysis: unknown
  analysed_at: Date | null
  confirmed_at: Date | null
  updated_at: Date
}

/** The one profile row, created on first read. */
export async function getProfile(): Promise<Profile> {
  const sql = db()
  await sql`insert into profile (id) values (1) on conflict (id) do nothing`
  const [row] = await sql<Profile[]>`
    select height_cm::float as height_cm,
           undertone, skin_depth, hair_colour, hair_texture, eye_colour, contrast_level,
           season, season_confidence,
           build, shoulder_hip, torso_leg, neck_length,
           sizes, fit_preferences, life, taste, budget,
           analysis, analysed_at, confirmed_at, updated_at
    from profile where id = 1
  `
  if (!row) throw new Error('profile row missing after insert')
  return row
}

export async function saveSizes(heightCm: number | null, sizes: Sizes, fits: Fits): Promise<void> {
  await db()`
    update profile
    set height_cm = ${heightCm},
        sizes = ${db().json(sizes)},
        fit_preferences = ${db().json(fits)}
    where id = 1
  `
}

export async function saveLife(life: Life): Promise<void> {
  await db()`update profile set life = ${db().json(life)} where id = 1`
}

export async function saveTaste(taste: Taste): Promise<void> {
  await db()`update profile set taste = ${db().json(taste)} where id = 1`
}

export async function saveBudget(budget: Budget): Promise<void> {
  await db()`update profile set budget = ${db().json(budget)} where id = 1`
}

export async function saveAnalysis(analysis: unknown): Promise<void> {
  await db()`
    update profile
    set analysis = ${db().json(analysis as Parameters<ReturnType<typeof db>['json']>[0])},
        analysed_at = now()
    where id = 1
  `
}

/** The confirmed read: Claude's proposal after Malin's corrections. */
export async function confirmColouring(values: Colouring): Promise<void> {
  await db()`
    update profile
    set undertone = ${values.undertone},
        skin_depth = ${values.skin_depth},
        hair_colour = ${values.hair_colour},
        hair_texture = ${values.hair_texture},
        eye_colour = ${values.eye_colour},
        contrast_level = ${values.contrast_level},
        season = ${values.season},
        season_confidence = ${values.season_confidence},
        build = ${values.build},
        shoulder_hip = ${values.shoulder_hip},
        torso_leg = ${values.torso_leg},
        neck_length = ${values.neck_length},
        confirmed_at = now()
    where id = 1
  `
}

export type { ParseResult }

export function parseSizesForm(form: FormData): ParseResult<{ height_cm: number | null; sizes: Sizes; fits: Fits }> {
  const height = number(form, 'height_cm')
  if (height === 'invalid') return { ok: false, errors: { height_cm: 'Enter a number' } }
  if (height !== null && (height < 100 || height > 250)) {
    return { ok: false, errors: { height_cm: 'Between 100 and 250 cm' } }
  }
  const sizes = finish(SizesSchema, {
    tee: text(form, 'tee'),
    chest_cm: number(form, 'chest_cm'),
    waist_cm: number(form, 'waist_cm'),
    hips_cm: number(form, 'hips_cm'),
    inseam_cm: number(form, 'inseam_cm'),
    sleeve_cm: number(form, 'sleeve_cm'),
    neck_cm: number(form, 'neck_cm'),
    shoe_eu: number(form, 'shoe_eu'),
    shoe_uk: number(form, 'shoe_uk'),
    shoe_us: number(form, 'shoe_us'),
  })
  if (!sizes.ok) return sizes
  const fits = finish(FitsSchema, {
    tops: text(form, 'tops'),
    knits: text(form, 'knits'),
    trousers: text(form, 'trousers'),
    outerwear: text(form, 'outerwear'),
  })
  if (!fits.ok) return fits
  return { ok: true, data: { height_cm: height, sizes: sizes.data, fits: fits.data } }
}

export function parseLifeForm(form: FormData): ParseResult<Life> {
  const chosen = form.getAll('gym_days').filter((day): day is string => typeof day === 'string')
  const gymDays = WEEKDAYS.filter((day) => chosen.includes(day))
  if (gymDays.length !== chosen.length) return { ok: false, errors: { gym_days: 'Choose days from the week' } }
  // A week saved before the days could be chosen keeps its count until they are.
  const count = number(form, 'gym')
  return finish(LifeSchema, {
    office: number(form, 'office'),
    gym: gymDays.length || (count === 'invalid' ? null : count),
    gym_days: gymDays.length ? gymDays : null,
    running: number(form, 'running'),
    evenings_out: number(form, 'evenings_out'),
    travel: text(form, 'travel'),
    notes: text(form, 'notes'),
  })
}

export function parseTasteForm(form: FormData): ParseResult<Taste> {
  return finish(TasteSchema, {
    references: text(form, 'references'),
    no_gos: text(form, 'no_gos'),
    owned: text(form, 'owned'),
  })
}

export function parseBudgetForm(form: FormData): ParseResult<Budget> {
  return finish(BudgetSchema, {
    tees: number(form, 'tees'),
    shirts: number(form, 'shirts'),
    knits: number(form, 'knits'),
    trousers: number(form, 'trousers'),
    outerwear: number(form, 'outerwear'),
    shoes: number(form, 'shoes'),
    accessories: number(form, 'accessories'),
    monthly: number(form, 'monthly'),
  })
}

export function parseColouringForm(form: FormData): ParseResult<Colouring> {
  return finish(ColouringSchema, {
    undertone: text(form, 'undertone'),
    skin_depth: text(form, 'skin_depth'),
    hair_colour: text(form, 'hair_colour'),
    hair_texture: text(form, 'hair_texture'),
    eye_colour: text(form, 'eye_colour'),
    contrast_level: text(form, 'contrast_level'),
    season: text(form, 'season'),
    season_confidence: number(form, 'season_confidence'),
    build: text(form, 'build'),
    shoulder_hip: text(form, 'shoulder_hip'),
    torso_leg: text(form, 'torso_leg'),
    neck_length: text(form, 'neck_length'),
  })
}
