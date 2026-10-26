/**
 * Google Play installs (운영실 D11): the monthly installs report Play
 * Console drops in its Cloud Storage bucket
 * (stats/installs/installs_<package>_<YYYYMM>_overview.csv, UTF-16LE). The
 * worker's own service account reads it once the owner invites that account
 * in Play Console (사용자 및 권한 → "앱 정보 보기, 대량 보고서 다운로드"), so no
 * new key file is needed. 설치 = "Daily User Installs" (first installs by
 * distinct users).
 *
 * Needs, in worker.env: PLAY_REPORTS_BUCKET (pubsite_prod_rev_…, from Play
 * Console → 보고서 다운로드 → 통계 → Cloud Storage URI) and PLAY_PACKAGE_NAME.
 * A month with no report yet answers 404 (not yet, not an error).
 */

import { getApp } from 'firebase-admin/app'

export const PLAY_ENV = ['PLAY_REPORTS_BUCKET', 'PLAY_PACKAGE_NAME'] as const

const env = (k: string) => process.env[k]?.trim() || ''

/** The env names still missing; empty when Play installs can be read. */
export function playMissing(): string[] {
  return PLAY_ENV.filter((k) => !env(k))
}

/** Text of a Play report: UTF-16LE with a BOM, or plain UTF-8 when not. */
export function decodePlayCsv(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  return buf.toString('utf8')
}

/** Installs per day (YYYY-MM-DD) from one monthly overview report. */
export function parsePlayInstalls(csv: string): Record<string, number> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return {}
  const head = lines[0].split(',').map((h) => h.trim())
  const iDate = head.indexOf('Date')
  let iUnits = head.indexOf('Daily User Installs')
  if (iUnits < 0) iUnits = head.indexOf('Daily Device Installs')
  if (iDate < 0 || iUnits < 0) throw new Error('not an installs report: no Date / Daily User Installs column')
  const out: Record<string, number> = {}
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const date = (cells[iDate] ?? '').trim()
    const n = Number((cells[iUnits] ?? '').trim())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(n)) continue
    out[date] = (out[date] ?? 0) + n
  }
  return out
}

/** An access token of the worker's service account (firebase-admin's credential). */
async function googleToken(): Promise<string> {
  const cred = getApp().options.credential
  if (!cred) throw new Error('the worker has no service-account credential')
  return (await cred.getAccessToken()).access_token
}

export type MonthFetch = { ok: true; days: Record<string, number> } | { ok: false; notYet: true } | { ok: false; notYet: false; error: string }

/** One month's installs (YYYYMM) from the Play reports bucket. */
export async function fetchPlayMonth(yyyymm: string, fetchFn: typeof fetch = fetch): Promise<MonthFetch> {
  const name = `stats/installs/installs_${env('PLAY_PACKAGE_NAME')}_${yyyymm}_overview.csv`
  let res: Response
  try {
    res = await fetchFn(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env('PLAY_REPORTS_BUCKET'))}/o/${encodeURIComponent(name)}?alt=media`, {
      headers: { Authorization: `Bearer ${await googleToken()}` }, signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    return { ok: false, notYet: false, error: String((err as Error).message ?? err).slice(0, 120) }
  }
  if (res.status === 404) return { ok: false, notYet: true }
  if (!res.ok) return { ok: false, notYet: false, error: `Play 보고서 버킷 ${res.status}${res.status === 403 ? ' (서비스 계정에 Play Console 권한이 없어요)' : ''}` }
  try {
    return { ok: true, days: parsePlayInstalls(decodePlayCsv(Buffer.from(await res.arrayBuffer()))) }
  } catch (err) {
    return { ok: false, notYet: false, error: (err as Error).message }
  }
}
