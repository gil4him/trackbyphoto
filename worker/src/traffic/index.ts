/**
 * 설치 for 운영실 성장 (D11): the last 30 days of first installs from the App
 * Store (asc.ts) and Google Play (play.ts). Days already read are kept in
 * admin_config/traffic so a worker restart does not re-read a month of
 * reports; only days without a report are asked for again, and a day the
 * store does not have yet is asked at most every 3 hours.
 *
 * A store without its env values reports `unconfigured` with the names
 * still missing; a store that answered badly reports `error` with the
 * message and whatever days it had. Nothing here invents a number: a day
 * without a report is `null`, and the UI says 연결 필요 / 아직 보고서 없음.
 */

import { getFirestore } from 'firebase-admin/firestore'
import { ascMissing, fetchAscDay, type DayFetch } from './asc.js'
import { fetchPlayMonth, playMissing, type MonthFetch } from './play.js'

const D = 86_400_000
export const WINDOW_DAYS = 30
const RETRY_MS = 3 * 60 * 60_000

export interface StoreInstalls {
  state: 'ok' | 'unconfigured' | 'error'
  /** Env names still missing (unconfigured). */
  missing: string[]
  error: string | null
  /** The window's dates, oldest first; `null` while the store has no report for that day. */
  days: { date: string; n: number | null }[]
  /** Installs over the days with a report. */
  total: number
  /** How many of the window's days have a report. */
  known: number
}
export interface Installs { ios: StoreInstalls; android: StoreInstalls }

type Stored = Record<string, number>
export interface TrafficDeps {
  now: number
  ascMissing: () => string[]
  playMissing: () => string[]
  fetchAscDay: (date: string) => Promise<DayFetch>
  fetchPlayMonth: (yyyymm: string) => Promise<MonthFetch>
  load: () => Promise<{ ios?: Stored; android?: Stored }>
  save: (patch: { ios?: Stored; android?: Stored }) => Promise<void>
}

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The window: `WINDOW_DAYS` dates ending yesterday (UTC), oldest first. */
export function windowDates(now: number): string[] {
  const end = Math.floor(now / D) * D - D
  return Array.from({ length: WINDOW_DAYS }, (_, i) => utcDate(end - (WINDOW_DAYS - 1 - i) * D))
}

const tried = new Map<string, number>()
export function resetTrafficThrottle() { tried.clear() }
const due = (key: string, now: number) => { const t = tried.get(key); return t === undefined || now - t >= RETRY_MS }

function summarize(dates: string[], known: Stored, state: StoreInstalls['state'], missing: string[], error: string | null): StoreInstalls {
  const days = dates.map((date) => ({ date, n: typeof known[date] === 'number' ? known[date] : null }))
  const have = days.filter((d) => d.n !== null)
  return { state, missing, error, days, total: have.reduce((s, d) => s + (d.n ?? 0), 0), known: have.length }
}

export async function installs(deps: TrafficDeps): Promise<Installs> {
  const dates = windowDates(deps.now)
  const [iosMissing, androidMissing] = [deps.ascMissing(), deps.playMissing()]
  const stored = iosMissing.length && androidMissing.length ? {} : await deps.load()
  const patch: { ios?: Stored; android?: Stored } = {}

  // App Store: one report per day; ask only for days we do not have.
  let ios: StoreInstalls
  if (iosMissing.length) ios = summarize(dates, {}, 'unconfigured', iosMissing, null)
  else {
    const known: Stored = { ...(stored.ios ?? {}) }
    let error: string | null = null
    const want = dates.filter((d) => typeof known[d] !== 'number' && due(`ios:${d}`, deps.now))
    for (let i = 0; i < want.length && !error; i += 5) {
      const answers = await Promise.all(want.slice(i, i + 5).map(async (d) => [d, await deps.fetchAscDay(d)] as const))
      for (const [d, a] of answers) {
        tried.set(`ios:${d}`, deps.now)
        if (a.ok) known[d] = a.units
        else if (!a.notYet) error = a.error
      }
    }
    if (Object.keys(known).length !== Object.keys(stored.ios ?? {}).length) patch.ios = known
    ios = summarize(dates, known, error ? 'error' : 'ok', [], error)
  }

  // Google Play: one report per month; re-read a month at most every 3 hours.
  let android: StoreInstalls
  if (androidMissing.length) android = summarize(dates, {}, 'unconfigured', androidMissing, null)
  else {
    const known: Stored = { ...(stored.android ?? {}) }
    let error: string | null = null
    const months = [...new Set(dates.map((d) => d.slice(0, 7).replace('-', '')))]
    for (const m of months) {
      if (!due(`android:${m}`, deps.now)) continue
      const a = await deps.fetchPlayMonth(m)
      tried.set(`android:${m}`, deps.now)
      if (a.ok) { for (const d of Object.keys(known)) if (d.slice(0, 7).replace('-', '') === m) delete known[d]; Object.assign(known, a.days) }
      else if (!a.notYet) error = a.error
    }
    if (JSON.stringify(known) !== JSON.stringify(stored.android ?? {})) patch.android = known
    android = summarize(dates, known, error ? 'error' : 'ok', [], error)
  }

  if (patch.ios || patch.android) await deps.save(patch)
  return { ios, android }
}

/** The worker's deps: real stores, admin_config/traffic for what was read. */
export function trafficDeps(now = Date.now()): TrafficDeps {
  const ref = () => getFirestore().doc('admin_config/traffic')
  return {
    now, ascMissing, playMissing, fetchAscDay, fetchPlayMonth,
    load: async () => { const d = (await ref().get()).data() ?? {}; return { ios: d.ios as Stored | undefined, android: d.android as Stored | undefined } },
    // mergeFields replaces a store's whole map (a re-read month may drop days a
    // corrected report no longer has); merge:true would only add to it.
    save: (patch) => ref().set({ ...patch, updatedAt: new Date(now) }, { mergeFields: [...Object.keys(patch), 'updatedAt'] }).then(() => undefined),
  }
}
