import { z } from 'zod'

import { PRODUCT_TOKEN } from './finder/http.ts'

/*
 * The day's weather in Wellington, for the outfit of the day. From
 * Open-Meteo's forecast API: free, no key, and the request carries nothing
 * but the city's coordinates. Its data is CC BY 4.0, so the card credits it.
 *
 * What a day is dressed for is the hours he is out, 7am to 10pm, not the
 * daily figures, which run midnight to midnight and would put the 3am low on
 * a lunchtime walk. The forecast is kept on the day's row as read, so the
 * card always shows the weather the outfit was chosen for.
 */

export const WELLINGTON = { name: 'Wellington', latitude: -41.2865, longitude: 174.7762 } as const

const ZONE = 'Pacific/Auckland'
const FIRST_HOUR = 7
const LAST_HOUR = 22
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const TIMEOUT_MS = 8000

// ---------------------------------------------------------------------------
// Dates and seasons
// ---------------------------------------------------------------------------

/** A New Zealand date as YYYY-MM-DD. */
export function nzDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: ZONE })
}

function nzHour(now: Date): number {
  return Number(now.toLocaleString('en-NZ', { hour: 'numeric', hourCycle: 'h23', timeZone: ZONE }))
}

/** The calendar day after a YYYY-MM-DD date. */
export function nextDate(date: string): string {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

/** From six in the evening he is dressing for tomorrow: what to lay out tonight. */
export const EVENING_HOUR = 18

/** The day an outfit opened now is for: today, or tomorrow from six in the evening. */
export function dressDate(now: Date = new Date()): string {
  const today = nzDate(now)
  return nzHour(now) >= EVENING_HOUR ? nextDate(today) : today
}

/** The southern hemisphere's calendar season, with where in it: "late spring". */
export function nzSeason(date: string): string {
  const month = Number(date.slice(5, 7))
  const seasons = ['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer']
  // December, March, June and September open a season; the middle month is plain.
  const where = ['', 'late ', 'early ', '', 'late ', 'early ', '', 'late ', 'early ', '', 'late ', 'early ']
  return `${where[month - 1]}${seasons[month - 1]}`
}

/** "Thursday 6 November", for a YYYY-MM-DD date. */
export function dateLabel(date: string): string {
  const noon = new Date(`${date}T12:00:00Z`)
  const part = (options: Intl.DateTimeFormatOptions) => noon.toLocaleDateString('en-NZ', { ...options, timeZone: 'UTC' })
  return `${part({ weekday: 'long' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })}`
}

/** "Thursday", for a YYYY-MM-DD date. */
export function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-NZ', { weekday: 'long', timeZone: 'UTC' })
}

// ---------------------------------------------------------------------------
// The forecast
// ---------------------------------------------------------------------------

export type Hour = {
  /** 7 to 22, New Zealand time. */
  hour: number
  temp: number
  feels: number
  rain_chance: number
  rain_mm: number
  wind_kmh: number
  gust_kmh: number
  wind_from: string
  sky: string
}

export type Forecast = {
  date: string
  read_at: string
  /** Over 7am to 10pm. */
  high: number
  low: number
  feels_high: number
  feels_low: number
  rain_chance: number
  rain_mm: number
  wind_kmh: number
  gust_kmh: number
  /** Where the strongest wind of the day comes from: "southerly". */
  wind_from: string
  /** The day's weather in a word or two: "showers", "partly cloudy". */
  sky: string
  uv: number | null
  hours: Hour[]
}

const numbers = z.array(z.number().nullable())

const ResponseSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: numbers,
    apparent_temperature: numbers,
    precipitation_probability: numbers,
    precipitation: numbers,
    weather_code: numbers,
    wind_speed_10m: numbers,
    wind_gusts_10m: numbers,
    wind_direction_10m: numbers,
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: numbers,
    uv_index_max: numbers,
  }),
})

export type ForecastResponse = z.infer<typeof ResponseSchema>

export function forecastUrl(date: string): string {
  const params = new URLSearchParams({
    latitude: String(WELLINGTON.latitude),
    longitude: String(WELLINGTON.longitude),
    timezone: ZONE,
    start_date: date,
    end_date: date,
    hourly: [
      'temperature_2m',
      'apparent_temperature',
      'precipitation_probability',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
      'wind_direction_10m',
    ].join(','),
    daily: 'weather_code,uv_index_max',
  })
  return `${ENDPOINT}?${params}`
}

/**
 * The forecast for one day, or null when it cannot be had (the service is
 * down, the date is past its range, the answer is not what was asked for).
 * The outfit is then dressed for the month's usual weather instead.
 */
export async function fetchForecast(date: string, fetcher: typeof fetch = fetch): Promise<Forecast | null> {
  try {
    const response = await fetcher(forecastUrl(date), {
      headers: { 'user-agent': `${PRODUCT_TOKEN} (a personal menswear app for one person in Wellington)` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const forecast = readForecast(date, ResponseSchema.parse(await response.json()))
    if (!forecast) throw new Error('no hours for the day')
    return forecast
  } catch (error) {
    console.warn(JSON.stringify({ event: 'weather.failed', date, message: (error as Error).message }))
    return null
  }
}

/** The day's waking hours from Open-Meteo's answer, summed up. Null when the hours are missing. */
export function readForecast(date: string, data: ForecastResponse, now: Date = new Date()): Forecast | null {
  const h = data.hourly
  const hours: Hour[] = []
  for (const [index, time] of h.time.entries()) {
    if (!time.startsWith(date)) continue
    const hour = Number(time.slice(11, 13))
    if (hour < FIRST_HOUR || hour > LAST_HOUR) continue
    const temp = h.temperature_2m[index]
    const feels = h.apparent_temperature[index]
    if (temp == null || feels == null) continue
    hours.push({
      hour,
      temp: Math.round(temp),
      feels: Math.round(feels),
      rain_chance: h.precipitation_probability[index] ?? 0,
      rain_mm: Math.round((h.precipitation[index] ?? 0) * 10) / 10,
      wind_kmh: Math.round(h.wind_speed_10m[index] ?? 0),
      gust_kmh: Math.round(h.wind_gusts_10m[index] ?? 0),
      wind_from: compass(h.wind_direction_10m[index] ?? 0),
      sky: sky(h.weather_code[index] ?? 0),
    })
  }
  if (hours.length < 8) return null

  const max = (pick: (hour: Hour) => number) => Math.max(...hours.map(pick))
  const min = (pick: (hour: Hour) => number) => Math.min(...hours.map(pick))
  const windiest = hours.reduce((best, hour) => (hour.wind_kmh > best.wind_kmh ? hour : best))
  const dayIndex = data.daily.time.indexOf(date)
  const code = dayIndex >= 0 ? data.daily.weather_code[dayIndex] : null
  const uv = dayIndex >= 0 ? data.daily.uv_index_max[dayIndex] : null

  return {
    date,
    read_at: now.toISOString(),
    high: max((hour) => hour.temp),
    low: min((hour) => hour.temp),
    feels_high: max((hour) => hour.feels),
    feels_low: min((hour) => hour.feels),
    rain_chance: max((hour) => hour.rain_chance),
    rain_mm: Math.round(hours.reduce((sum, hour) => sum + hour.rain_mm, 0) * 10) / 10,
    wind_kmh: windiest.wind_kmh,
    gust_kmh: max((hour) => hour.gust_kmh),
    wind_from: windiest.wind_from,
    sky: code == null ? windiest.sky : sky(code),
    uv: uv == null ? null : Math.round(uv),
    hours,
  }
}

/** Where the wind comes from, as Wellington says it: 200 degrees is a southerly. */
export function compass(degrees: number): string {
  const points = ['northerly', 'north-easterly', 'easterly', 'south-easterly', 'southerly', 'south-westerly', 'westerly', 'north-westerly']
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!
}

/** A WMO weather code in words. */
export function sky(code: number): string {
  if (code === 0) return 'clear'
  if (code === 1) return 'mostly clear'
  if (code === 2) return 'partly cloudy'
  if (code === 3) return 'overcast'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if (code >= 61 && code <= 67) return 'rain'
  if (code >= 71 && code <= 77) return 'snow'
  if (code >= 80 && code <= 82) return 'showers'
  if (code === 85 || code === 86) return 'snow showers'
  if (code >= 95) return 'thunderstorms'
  return 'unsettled'
}

const WET = ['drizzle', 'rain', 'showers', 'snow', 'snow showers', 'thunderstorms']

/** "3pm", "10am", "noon". */
function clock(hour: number): string {
  if (hour === 12) return 'noon'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}

/** When it is likely to rain, in a phrase: "showers likely from 3pm", "dry". */
export function rainPhrase(forecast: Pick<Forecast, 'hours' | 'rain_chance'>): string {
  const wet = forecast.hours.filter((hour) => hour.rain_chance >= 50)
  if (wet.length === 0) return forecast.rain_chance >= 30 ? 'A chance of a shower' : 'Dry'
  // The kind of wet the wettest hours bring, else plain rain.
  const kind = wet.map((hour) => hour.sky).find((word) => WET.includes(word)) ?? 'rain'
  const what = `${capital(kind)} likely`
  const first = wet[0]!.hour
  const last = wet.at(-1)!.hour
  const span = forecast.hours.length
  if (wet.length >= span * 0.7) return `${what} most of the day`
  if (first <= FIRST_HOUR) return `${what} until ${clock(last + 1)}`
  if (last >= LAST_HOUR) return `${what} from ${clock(first)}`
  return `${what} from ${clock(first)} to ${clock(last + 1)}`
}

/** "Southerly 35 km/h, gusts to 70", "Light northerly". */
export function windPhrase(forecast: Pick<Forecast, 'wind_kmh' | 'gust_kmh' | 'wind_from'>): string {
  if (forecast.wind_kmh < 12 && forecast.gust_kmh < 30) return `Light ${forecast.wind_from}`
  const gusts = forecast.gust_kmh >= 40 ? `, gusts to ${forecast.gust_kmh}` : ''
  return `${capital(forecast.wind_from)} ${forecast.wind_kmh} km/h${gusts}`
}

/** "11° to 17°, feels like 8°" */
export function temperaturePhrase(forecast: Pick<Forecast, 'low' | 'high' | 'feels_low'>): string {
  const range = forecast.low === forecast.high ? `${forecast.low}°` : `${forecast.low}° to ${forecast.high}°`
  return forecast.feels_low <= forecast.low - 2 ? `${range}, feels like ${forecast.feels_low}°` : range
}

/** The day in one line for the card: "11° to 17°, feels like 8°. Southerly 35 km/h, gusts to 70. Showers likely from 3pm." */
export function forecastLine(forecast: Forecast): string {
  const rain = rainPhrase(forecast)
  const dry = rain === 'Dry' && WET.every((word) => word !== forecast.sky) ? `Dry, ${forecast.sky}` : rain
  return `${temperaturePhrase(forecast)}. ${windPhrase(forecast)}. ${dry}.`
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
