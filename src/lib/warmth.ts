import { OUTER, TOPS } from './look-rules.ts'
import type { GarmentType, Warmth } from './wardrobe-values.ts'

/*
 * How warm an outfit may be for a day, and how warm a piece is. Opus left to
 * itself overdressed him: three layers with a wool knit on a summer day,
 * because Wellington reads as cold and windy and a season reads as a fabric
 * weight. So the day's warmth is a limit read from the forecast, stated in
 * the prompt and held by code (tidyDay drops an option over it).
 *
 * The limit goes by the warmest the day feels between 7am and 10pm. The
 * feels-like figure already counts the wind, so nothing here adds warmth for
 * it again. Cool mornings and evenings are answered by one light layer he can
 * carry, which every limit leaves room for.
 *
 * A piece's warmth is what he or the photo read said; when neither did (a
 * piece from the blueprint, a find or typed in), it is read from the garment
 * and the cloth its name and fabric give. Pure, so it runs anywhere.
 */

/** The tops, tailoring and outer layers on him at once: a tee under a shirt is two. */
export const LAYERS: GarmentType[] = [...TOPS, ...OUTER, 'tailoring']

export type WarmthBand = 'hot' | 'warm' | 'mild' | 'cold'

export type WarmthLimit = {
  band: WarmthBand
  /** The warmest the day feels, in degrees, that the limit was read from. */
  feels_high: number
  /** Most layers at once; null when the day takes what it needs. */
  most_layers: number | null
  /** Most pieces of warmth "warm"; null when there is no limit. */
  most_warm_pieces: number | null
  /** Garments too warm for the day whatever they are made of. */
  ruled_out: GarmentType[]
}

/** From the warmest band down; a day is in the first whose `from` it reaches. */
const BANDS: (Omit<WarmthLimit, 'feels_high'> & { from: number })[] = [
  { band: 'hot', from: 22, most_layers: 2, most_warm_pieces: 0, ruled_out: ['knitwear', 'sweatshirt', 'coat'] },
  { band: 'warm', from: 18, most_layers: 2, most_warm_pieces: 0, ruled_out: ['coat'] },
  { band: 'mild', from: 14, most_layers: 3, most_warm_pieces: 1, ruled_out: [] },
  { band: 'cold', from: -Infinity, most_layers: null, most_warm_pieces: null, ruled_out: [] },
]

/** The limit for a day that feels at most this warm. */
export function warmthLimit(feelsHigh: number): WarmthLimit {
  const { band, most_layers, most_warm_pieces, ruled_out } = BANDS.find((band) => feelsHigh >= band.from)!
  return { band, feels_high: feelsHigh, most_layers, most_warm_pieces, ruled_out }
}

/** The limit as the prompts give it, with what it was read from: a forecast, or the month's usual high. */
export function limitForPrompt(limit: WarmthLimit, readFrom = `feels like ${limit.feels_high}° at the warmest`) {
  return {
    read_from: readFrom,
    most_layers: limit.most_layers,
    most_warm_pieces: limit.most_warm_pieces,
    garments_ruled_out: limit.ruled_out,
  }
}

function count(n: number): string {
  return ['no', 'one', 'two', 'three', 'four'][n] ?? String(n)
}

function bandInWords(band: (typeof BANDS)[number], next: number | null): string {
  const range = Number.isFinite(band.from)
    ? next === null
      ? `from ${band.from}°`
      : `${band.from}° to ${next - 1}°`
    : `under ${BANDS.at(-2)!.from}°`
  if (band.most_layers === null) return `${range}, what the day needs`
  const parts = [`at most ${count(band.most_layers)} layers`]
  parts.push(band.most_warm_pieces === 0 ? 'nothing warm' : `at most ${count(band.most_warm_pieces!)} warm piece${band.most_warm_pieces === 1 ? '' : 's'}`)
  if (band.ruled_out.length > 0) {
    const names = band.ruled_out.map((type) => (type === 'knitwear' ? 'knitwear' : `${type}s`))
    parts.push(`no ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]}`)
  }
  return `${range}, ${parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join(' and ')}`
}

/** The bands in a sentence, from the same numbers code holds the outfits to. */
export const WARMTH_RULES = `Each piece says how warm it is: light, mid or warm. Layers are the tops, tailoring and outer layers on him at once: a tee under a shirt is two, a jacket over them three. How many a day takes goes by the warmest it feels: ${BANDS.map((band, index) =>
  bandInWords(band, index === 0 ? null : BANDS[index - 1]!.from),
).join('; ')}. Overdressing is the commoner mistake: when in doubt, one layer fewer and lighter cloth. The feels-like figure already counts the wind, so never add a layer for the wind on top of it.`

// ---------------------------------------------------------------------------
// A piece's warmth
// ---------------------------------------------------------------------------

// "button-down" is a collar, not a filling.
const WARM_CLOTH =
  /\b(wool|woollen|woolen|merino|cashmere|lambswool|alpaca|mohair|shetland|fleece|flannel|tweed|cord|cords|corduroy|moleskin|(?<!button-)down|puffer|padded|quilted|sherpa|shearling|boucl[eé]|melton|loden|chunky|cable)\b/i
const WARM_BOTTOMS = /\b(flannel|tweed|cord|cords|corduroy|moleskin|fleece|brushed)\b/i
const LIGHT_CLOTH = /\b(linen|seersucker|poplin|voile|chambray|mesh|ripstop|nylon|shell|rain|raincoat|windbreaker|trench|mac)\b/i

type Warmable = { garment_type: GarmentType; warmth: Warmth | null; fabric: string | null; name: string }

/** How warm a piece is; null for shoes and what is carried, which no limit counts. */
export function pieceWarmth(piece: Warmable): Warmth | null {
  const type = piece.garment_type
  if (['shoes', 'boots', 'sneakers', 'belt', 'accessory', 'bag'].includes(type)) return null
  if (piece.warmth) return piece.warmth
  const words = `${piece.name} ${piece.fabric ?? ''}`
  const warm = WARM_CLOTH.test(words)
  const light = LIGHT_CLOTH.test(words)
  switch (type) {
    case 'tee':
    case 'tank':
    case 'polo':
    case 'shorts':
    case 'activewear':
      return 'light'
    case 'shirt':
      return warm ? 'mid' : 'light'
    case 'knitwear':
    case 'sweatshirt':
      return warm ? 'warm' : 'mid'
    case 'coat':
      return light && !warm ? 'mid' : 'warm'
    case 'trousers':
    case 'jeans':
      return WARM_BOTTOMS.test(words) ? 'warm' : /\b(linen|seersucker)\b/i.test(words) ? 'light' : 'mid'
    default:
      // overshirt, jacket, tailoring
      return warm ? 'warm' : light ? 'light' : 'mid'
  }
}

/** Whether an outfit's pieces sit within the day's limit. */
export function withinWarmth(pieces: Warmable[], limit: WarmthLimit | null): boolean {
  if (!limit) return true
  const layers = pieces.filter((piece) => LAYERS.includes(piece.garment_type)).length
  const warm = pieces.filter((piece) => pieceWarmth(piece) === 'warm').length
  return (
    (limit.most_layers === null || layers <= limit.most_layers) &&
    (limit.most_warm_pieces === null || warm <= limit.most_warm_pieces) &&
    !pieces.some((piece) => limit.ruled_out.includes(piece.garment_type))
  )
}
