// The weather where and when a photo was taken, from Apple WeatherKit (REST),
// for the memo's "기억의 고리" ("맑고 따뜻한 일요일"). Facts only: the model is
// told never to guess weather from the light in a picture.
//
// Configured by four settings in worker.env (all needed; otherwise weather is
// simply left out of the memo):
//   WEATHERKIT_TEAM_ID      Apple Developer Team ID (10 characters)
//   WEATHERKIT_KEY_ID       the Key ID of a key with the WeatherKit service
//   WEATHERKIT_SERVICE_ID   an identifier you registered for WeatherKit (e.g. the app's bundle id)
//   WEATHERKIT_KEY_PATH     path to that key's .p8 file (or WEATHERKIT_KEY with its contents)
// 500,000 calls a month come with the Apple Developer Program. Showing the
// data requires the Apple Weather attribution in the app.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createPrivateKey, sign, type KeyObject } from 'node:crypto'
import { logger } from './log.js'

export interface Weather {
  /** WeatherKit conditionCode ("Clear", "Rain", …). */
  code: string
  /** Korean word for it ("맑음"); '' when the code is unknown. */
  label: string
  tempC: number
  /** How the temperature feels, in Korean ("따뜻한 날"). */
  feel: string
}

const CONDITIONS: Record<string, string> = {
  Clear: '맑음', MostlyClear: '대체로 맑음', PartlyCloudy: '구름 조금', MostlyCloudy: '구름 많음', Cloudy: '흐림',
  Foggy: '안개', Haze: '연무', Smoky: '연기', BlowingDust: '황사·먼지바람', Breezy: '산들바람', Windy: '바람이 강함',
  Drizzle: '이슬비', Rain: '비', HeavyRain: '많은 비', SunShowers: '여우비', IsolatedThunderstorms: '곳에 따라 뇌우',
  ScatteredThunderstorms: '뇌우', Thunderstorms: '뇌우', StrongStorms: '강한 폭풍우', TropicalStorm: '열대 폭풍', Hurricane: '태풍',
  Flurries: '눈발', SunFlurries: '눈발', Snow: '눈', HeavySnow: '많은 눈', BlowingSnow: '눈보라', Blizzard: '눈보라',
  Sleet: '진눈깨비', WintryMix: '진눈깨비', FreezingDrizzle: '얼어붙는 이슬비', FreezingRain: '어는 비', Hail: '우박',
  Hot: '무더위', Frigid: '혹한',
}

/** The temperature as a family would say it. */
export function feelOf(tempC: number): string {
  if (tempC < 0) return '매우 추운 날'
  if (tempC < 8) return '추운 날'
  if (tempC < 15) return '쌀쌀한 날'
  if (tempC < 21) return '선선한 날'
  if (tempC < 27) return '따뜻한 날'
  if (tempC < 32) return '더운 날'
  return '무더운 날'
}

export function weatherOf(code: string, tempC: number): Weather {
  return { code, label: CONDITIONS[code] ?? '', tempC: Math.round(tempC), feel: feelOf(tempC) }
}

/** One line for the prompt: "맑음, 24°C (따뜻한 날)". */
export function weatherText(w: Weather): string {
  return `${w.label ? `${w.label}, ` : ''}${w.tempC}°C (${w.feel})`
}

const env = (k: string) => process.env[k]?.trim() || ''

export function weatherKitConfigured(): boolean {
  return !!(env('WEATHERKIT_TEAM_ID') && env('WEATHERKIT_KEY_ID') && env('WEATHERKIT_SERVICE_ID') && (env('WEATHERKIT_KEY_PATH') || env('WEATHERKIT_KEY')))
}

let key: KeyObject | null = null
let jwt: { token: string; expiresAt: number } | null = null

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

/** A developer token for WeatherKit, ES256, reused for 50 minutes. */
function token(): string {
  const now = Math.floor(Date.now() / 1000)
  if (jwt && jwt.expiresAt > now + 60) return jwt.token
  if (!key) {
    const pem = env('WEATHERKIT_KEY') || readFileSync(env('WEATHERKIT_KEY_PATH').replace(/^~(?=\/)/, homedir()), 'utf8')
    key = createPrivateKey(pem.replace(/\\n/g, '\n'))
  }
  const team = env('WEATHERKIT_TEAM_ID')
  const service = env('WEATHERKIT_SERVICE_ID')
  const header = { alg: 'ES256', kid: env('WEATHERKIT_KEY_ID'), id: `${team}.${service}` }
  const payload = { iss: team, iat: now, exp: now + 3600, sub: service }
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
  jwt = { token: `${input}.${b64url(signature)}`, expiresAt: now + 3000 }
  return jwt.token
}

const cache = new Map<string, Weather | null>()
const CACHE_MAX = 500

/**
 * The weather at a spot in the hour a photo was taken (past hours included);
 * null when WeatherKit isn't configured or doesn't answer. Never throws:
 * weather is a nicety, a memo never waits on it.
 */
export async function weatherAt(lat: number, lng: number, at: Date): Promise<Weather | null> {
  if (!weatherKitConfigured()) return null
  const hour = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000)
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${hour.toISOString()}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)!
  const base = env('WEATHERKIT_BASE_URL') || 'https://weatherkit.apple.com'
  const end = new Date(hour.getTime() + 3_600_000)
  const url = `${base}/api/v1/weather/ko/${lat.toFixed(4)}/${lng.toFixed(4)}?dataSets=forecastHourly&hourlyStart=${hour.toISOString()}&hourlyEnd=${end.toISOString()}&timezone=Etc/UTC`
  let result: Weather | null = null
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { forecastHourly?: { hours?: { conditionCode?: string; temperature?: number }[] } }
    const h = json.forecastHourly?.hours?.[0]
    if (h && typeof h.temperature === 'number') result = weatherOf(h.conditionCode ?? '', h.temperature)
  } catch (err) {
    logger.warn('[weather] WeatherKit lookup failed', { err: String(err).slice(0, 160) })
    return null // not cached: try again for the next photo
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(cacheKey, result)
  return result
}

/** For scripts/weather-check.ts: one raw call, status and the start of the body. */
export async function weatherProbe(lat: number, lng: number, at: Date): Promise<{ status: number; body: string }> {
  const base = env('WEATHERKIT_BASE_URL') || 'https://weatherkit.apple.com'
  const hour = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000)
  const end = new Date(hour.getTime() + 3_600_000)
  const url = `${base}/api/v1/weather/ko/${lat.toFixed(4)}/${lng.toFixed(4)}?dataSets=forecastHourly&hourlyStart=${hour.toISOString()}&hourlyEnd=${end.toISOString()}&timezone=Etc/UTC`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(10000) })
  return { status: res.status, body: (await res.text()).slice(0, 300) }
}
