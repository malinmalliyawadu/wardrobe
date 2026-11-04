import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  compass,
  dateLabel,
  dressDate,
  fetchForecast,
  forecastLine,
  forecastUrl,
  nextDate,
  nzSeason,
  rainPhrase,
  readForecast,
  windPhrase,
  type ForecastResponse,
} from '../src/lib/weather.ts'

/*
 * The weather for the outfit of the day: dates in New Zealand, the season,
 * Open-Meteo's answer read into the hours he is out, and the phrases the card
 * shows. The network is never touched; the fetcher is a fake.
 */

/** A day of hourly readings, midnight to 11pm, with `at` overriding single hours. */
function day(date: string, at: Record<number, Partial<{ temp: number; feels: number; rain: number; mm: number; code: number; wind: number; gust: number; dir: number }>> = {}): ForecastResponse {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ temp: 14, feels: 12, rain: 0, mm: 0, code: 2, wind: 20, gust: 35, dir: 180, ...at[hour] }))
  return {
    hourly: {
      time: hours.map((_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`),
      temperature_2m: hours.map((h) => h.temp),
      apparent_temperature: hours.map((h) => h.feels),
      precipitation_probability: hours.map((h) => h.rain),
      precipitation: hours.map((h) => h.mm),
      weather_code: hours.map((h) => h.code),
      wind_speed_10m: hours.map((h) => h.wind),
      wind_gusts_10m: hours.map((h) => h.gust),
      wind_direction_10m: hours.map((h) => h.dir),
    },
    daily: { time: [date], weather_code: [80], uv_index_max: [6.4] },
  }
}

describe('dates and seasons in New Zealand', () => {
  test('the season is the southern one, with where in it', () => {
    assert.equal(nzSeason('2026-11-05'), 'late spring')
    assert.equal(nzSeason('2026-12-01'), 'early summer')
    assert.equal(nzSeason('2027-01-15'), 'summer')
    assert.equal(nzSeason('2026-07-01'), 'winter')
    assert.equal(nzSeason('2026-03-10'), 'early autumn')
  })

  test('from six in the evening, New Zealand time, the outfit is for tomorrow', () => {
    // November is daylight time, UTC+13.
    assert.equal(dressDate(new Date('2026-11-05T04:59:00Z')), '2026-11-05', '5:59pm')
    assert.equal(dressDate(new Date('2026-11-05T05:00:00Z')), '2026-11-06', '6pm')
    assert.equal(dressDate(new Date('2026-11-05T10:59:00Z')), '2026-11-06', '11:59pm')
    assert.equal(dressDate(new Date('2026-11-05T11:00:00Z')), '2026-11-06', 'just after midnight it is that day')
  })

  test('the next day crosses months and years', () => {
    assert.equal(nextDate('2026-11-30'), '2026-12-01')
    assert.equal(nextDate('2026-12-31'), '2027-01-01')
    assert.equal(dateLabel('2026-11-06'), 'Friday 6 November')
  })

  test('a wind is named for where it comes from', () => {
    assert.equal(compass(180), 'southerly')
    assert.equal(compass(200), 'southerly')
    assert.equal(compass(350), 'northerly')
    assert.equal(compass(-10), 'northerly')
    assert.equal(compass(315), 'north-westerly')
  })
})

describe("Open-Meteo's answer", () => {
  test('the day is the hours he is out, 7am to 10pm, not midnight to midnight', () => {
    const forecast = readForecast(
      '2026-11-06',
      day('2026-11-06', { 3: { temp: 5, feels: 1 }, 7: { temp: 9, feels: 6 }, 14: { temp: 18, feels: 17 }, 23: { temp: 4 } }),
    )
    assert.ok(forecast)
    assert.equal(forecast.hours.length, 16)
    assert.equal(forecast.low, 9, 'the 3am and 11pm lows are not his')
    assert.equal(forecast.high, 18)
    assert.equal(forecast.feels_low, 6)
    assert.equal(forecast.sky, 'showers', 'from the daily code')
    assert.equal(forecast.uv, 6)
  })

  test('the strongest wind of the day sets its direction', () => {
    const forecast = readForecast('2026-11-06', day('2026-11-06', { 16: { wind: 45, gust: 80, dir: 350 } }))!
    assert.equal(forecast.wind_kmh, 45)
    assert.equal(forecast.gust_kmh, 80)
    assert.equal(forecast.wind_from, 'northerly')
    assert.equal(windPhrase(forecast), 'Northerly 45 km/h, gusts to 80')
    assert.equal(windPhrase({ wind_kmh: 8, gust_kmh: 20, wind_from: 'southerly' }), 'Light southerly')
  })

  test('another day in the answer, or too few hours, is no forecast', () => {
    assert.equal(readForecast('2026-11-07', day('2026-11-06')), null)
  })
})

describe('the phrases on the card', () => {
  const wet = (from: number, to: number, code = 80) =>
    readForecast(
      '2026-11-06',
      day('2026-11-06', Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, { rain: 70, mm: 0.6, code }]))),
    )!

  test('when the rain is likely, in his hours', () => {
    assert.equal(rainPhrase(wet(15, 22)), 'Showers likely from 3pm')
    assert.equal(rainPhrase(wet(7, 10, 61)), 'Rain likely until 11am')
    assert.equal(rainPhrase(wet(11, 13, 53)), 'Drizzle likely from 11am to 2pm')
    assert.equal(rainPhrase(wet(7, 20)), 'Showers likely most of the day')
    assert.equal(rainPhrase({ hours: [], rain_chance: 35 }), 'A chance of a shower')
    assert.equal(rainPhrase({ hours: [], rain_chance: 5 }), 'Dry')
  })

  test('the whole line', () => {
    const forecast = readForecast('2026-11-06', day('2026-11-06', { 7: { temp: 11, feels: 7 }, 13: { temp: 17 }, 15: { rain: 60, code: 80 } }))!
    assert.equal(forecastLine(forecast), '11° to 17°, feels like 7°. Southerly 20 km/h. Showers likely from 3pm to 4pm.')
    const dry = readForecast('2026-11-06', { ...day('2026-11-06'), daily: { time: ['2026-11-06'], weather_code: [1], uv_index_max: [null] } })!
    assert.equal(forecastLine(dry), '14°, feels like 12°. Southerly 20 km/h. Dry, mostly clear.')
  })
})

describe('reading it', () => {
  test('asks for one day in Wellington, in its time zone', () => {
    const url = new URL(forecastUrl('2026-11-06'))
    assert.equal(url.searchParams.get('start_date'), '2026-11-06')
    assert.equal(url.searchParams.get('end_date'), '2026-11-06')
    assert.equal(url.searchParams.get('timezone'), 'Pacific/Auckland')
    assert.equal(url.searchParams.get('latitude'), '-41.2865')
  })

  test('a good answer is read; a failed or malformed one is no forecast, never an error', async () => {
    const answer = (body: unknown, status = 200) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    const forecast = await fetchForecast('2026-11-06', answer(day('2026-11-06')))
    assert.equal(forecast?.date, '2026-11-06')

    const warn = console.warn
    console.warn = () => {}
    try {
      assert.equal(await fetchForecast('2026-11-06', answer({ error: true, reason: 'down' }, 500)), null)
      assert.equal(await fetchForecast('2026-11-06', answer({ hourly: {} })), null)
      const offline = (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch
      assert.equal(await fetchForecast('2026-11-06', offline), null)
    } finally {
      console.warn = warn
    }
  })
})
