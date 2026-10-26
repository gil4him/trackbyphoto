/**
 * App Store installs (운영실 D11): one day of Apple's Sales and Trends
 * summary report, read through the App Store Connect API with the same kind
 * of ES256 developer token WeatherKit uses (worker/src/weather.ts). Only
 * first downloads of the app count as 설치: re-downloads, updates and
 * in-app purchases are other product types.
 *
 * Needs, in worker.env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (the .p8),
 * ASC_VENDOR_NUMBER (App Store Connect → Payments and Financial Reports),
 * and optionally ASC_APP_ID (the app's Apple ID) when the account sells
 * more than one app. Reports for a day appear about a day later; until
 * then Apple answers 404, which is "not yet", not an error.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { createPrivateKey, sign, type KeyObject } from 'node:crypto'

export const ASC_ENV = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH', 'ASC_VENDOR_NUMBER'] as const

const env = (k: string) => process.env[k]?.trim() || ''

/** The env names still missing; empty when App Store installs can be read. */
export function ascMissing(): string[] {
  return ASC_ENV.filter((k) => !env(k))
}

/** Product types that are a first download of an app (Apple's report guide). */
const FIRST_DOWNLOAD = new Set(['1', '1F', '1T', '1E', '1EP', '1EU', 'F1'])

/**
 * Units of first downloads in one summary report (tab separated, header
 * first), in all and by country. `appId` keeps one app's rows only.
 */
export function parseSalesReport(tsv: string, appId = ''): { units: number; byCountry: Record<string, number> } {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { units: 0, byCountry: {} }
  const head = lines[0].split('\t').map((h) => h.trim())
  const col = (name: string) => head.indexOf(name)
  const iType = col('Product Type Identifier'), iUnits = col('Units'), iCountry = col('Country Code'), iApp = col('Apple Identifier')
  if (iType < 0 || iUnits < 0) throw new Error('not a sales report: no Product Type Identifier / Units column')
  let units = 0
  const byCountry: Record<string, number> = {}
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    if (!FIRST_DOWNLOAD.has((cells[iType] ?? '').trim())) continue
    if (appId && iApp >= 0 && (cells[iApp] ?? '').trim() !== appId) continue
    const n = Number((cells[iUnits] ?? '').trim())
    if (!Number.isFinite(n)) continue
    units += n
    const c = iCountry >= 0 ? (cells[iCountry] ?? '').trim() || '??' : '??'
    byCountry[c] = (byCountry[c] ?? 0) + n
  }
  return { units, byCountry }
}

let key: KeyObject | null = null
let jwt: { token: string; expiresAt: number } | null = null
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

/** An App Store Connect API token (ES256, 20 minutes), reused while fresh. */
export function ascToken(): string {
  const now = Math.floor(Date.now() / 1000)
  if (jwt && jwt.expiresAt > now + 60) return jwt.token
  if (!key) {
    const pem = readFileSync(env('ASC_KEY_PATH').replace(/^~(?=\/)/, homedir()), 'utf8')
    key = createPrivateKey(pem.replace(/\\n/g, '\n'))
  }
  const header = { alg: 'ES256', kid: env('ASC_KEY_ID'), typ: 'JWT' }
  const payload = { iss: env('ASC_ISSUER_ID'), iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
  jwt = { token: `${input}.${b64url(signature)}`, expiresAt: now + 1200 }
  return jwt.token
}

export type DayFetch = { ok: true; units: number; byCountry: Record<string, number> } | { ok: false; notYet: true } | { ok: false; notYet: false; error: string }

/** Apple answers 404 both for a day nobody downloaded anything ("There were no
 *  sales for the date specified.") and for a day it has not reported yet; the
 *  body tells them apart. A no-sales day is a known 0, not a day to ask again. */
export function ascNotFound(body: string): DayFetch {
  return /no sales for the date/i.test(body) ? { ok: true, units: 0, byCountry: {} } : { ok: false, notYet: true }
}

/** One day's first downloads from Apple, YYYY-MM-DD as Apple dates it. */
export async function fetchAscDay(date: string, fetchFn: typeof fetch = fetch): Promise<DayFetch> {
  const q = new URLSearchParams({
    'filter[frequency]': 'DAILY', 'filter[reportDate]': date, 'filter[reportSubType]': 'SUMMARY',
    'filter[reportType]': 'SALES', 'filter[vendorNumber]': env('ASC_VENDOR_NUMBER'), 'filter[version]': '1_0',
  })
  let res: Response
  try {
    res = await fetchFn(`https://api.appstoreconnect.apple.com/v1/salesReports?${q}`, {
      headers: { Authorization: `Bearer ${ascToken()}`, Accept: 'application/a-gzip' }, signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    return { ok: false, notYet: false, error: String((err as Error).message ?? err).slice(0, 120) }
  }
  if (res.status === 404) return ascNotFound(await res.text().catch(() => ''))
  if (!res.ok) return { ok: false, notYet: false, error: `App Store Connect ${res.status}` }
  const body = Buffer.from(await res.arrayBuffer())
  const text = body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body).toString('utf8') : body.toString('utf8')
  try {
    return { ok: true, ...parseSalesReport(text, env('ASC_APP_ID')) }
  } catch (err) {
    return { ok: false, notYet: false, error: (err as Error).message }
  }
}
