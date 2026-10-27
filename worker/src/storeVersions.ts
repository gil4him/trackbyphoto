/**
 * The latest store version of the app, for the family's app-update notice.
 *
 * Once at start and every hour the worker asks the App Store (iTunes lookup,
 * no key) and Google Play (androidpublisher v3, the production track, through
 * the same service account and PLAY_PACKAGE_NAME as reviews/play.ts) which
 * version is out, and writes system/app:
 *
 *   { ios: { version, source: 'itunes' | 'override', checkedAt },
 *     android: { version, source: 'play' | 'override', checkedAt } }
 *
 * admin_config/app { ios?, android? } wins over a lookup (a release still
 * rolling out, a store that can't be read). A failed lookup keeps the last
 * good value; a platform nobody knows is left out. Best effort: never throws.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from './log.js'
import { playReviewsMissing, playToken } from './reviews/play.js'

const EVERY_MS = 60 * 60_000
const TIMEOUT_MS = 15_000
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup?id=6821605732&country=kr'
const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'

export type StorePlatform = 'ios' | 'android'

/** "1.0.2", "1.0" → "1.0.0", "29884623 (1.0.2)" → "1.0.2"; null when there is no x.y(.z). */
export function normaliseVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return null
  return `${Number(m[1])}.${Number(m[2])}.${Number(m[3] ?? 0)}`
}

/** Numeric x.y.z order: compareVersions('1.0.2', '1.0.10') < 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** The iTunes lookup answer: results[0].version. */
export function parseItunesLookup(json: unknown): string | null {
  const results = (json as { results?: unknown })?.results
  if (!Array.isArray(results) || results.length === 0) return null
  return normaliseVersion((results[0] as { version?: unknown })?.version)
}

/** Play's tracks.get for production: the newest release that is out
 *  (completed, or still rolling out), by its release name. */
export function parsePlayTrack(json: unknown): string | null {
  const releases = (json as { releases?: unknown })?.releases
  if (!Array.isArray(releases)) return null
  const out = releases
    .filter((r: { status?: unknown }) => r?.status === 'completed' || r?.status === 'inProgress')
    .map((r: { name?: unknown }) => normaliseVersion(r?.name))
    .filter((v): v is string => !!v)
  if (out.length === 0) return null
  return out.sort(compareVersions)[out.length - 1]
}

export async function fetchIosVersion(fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(ITUNES_LOOKUP, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`iTunes lookup ${res.status}`)
  return parseItunesLookup(await res.json())
}

/** A throwaway edit is the only way to read a track: insert, read, delete. */
export async function fetchAndroidVersion(
  fetchFn: typeof fetch = fetch,
  token: (f: typeof fetch) => Promise<string> = playToken,
): Promise<string | null> {
  const pkg = encodeURIComponent(process.env.PLAY_PACKAGE_NAME?.trim() || '')
  const headers = { Authorization: `Bearer ${await token(fetchFn)}` }
  const insert = await fetchFn(`${PLAY_API}/${pkg}/edits`, { method: 'POST', headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!insert.ok) throw new Error(`Play edits.insert ${insert.status}`)
  const editId = String(((await insert.json()) as { id?: unknown }).id ?? '')
  if (!editId) throw new Error('Play edits.insert gave no id')
  try {
    const track = await fetchFn(`${PLAY_API}/${pkg}/edits/${encodeURIComponent(editId)}/tracks/production`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!track.ok) throw new Error(`Play tracks.get ${track.status}`)
    return parsePlayTrack(await track.json())
  } finally {
    await fetchFn(`${PLAY_API}/${pkg}/edits/${encodeURIComponent(editId)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      .catch((err) => logger.warn('[storeVersions] Play edit not deleted', { err: String(err) }))
  }
}

/** Injected so tests run without the stores. */
export interface StoreVersionDeps {
  ios: () => Promise<string | null>
  /** Absent when Play isn't configured (no PLAY_PACKAGE_NAME / key). */
  android?: () => Promise<string | null>
}

export function playConfigured(): boolean {
  return playReviewsMissing().length === 0
}

export const defaultStoreVersionDeps = (): StoreVersionDeps => ({
  ios: () => fetchIosVersion(),
  ...(playConfigured() ? { android: () => fetchAndroidVersion() } : {}),
})

/** Look both stores up (an override wins) and merge what is known into system/app. Never throws. */
export async function refreshStoreVersions(deps: StoreVersionDeps = defaultStoreVersionDeps()): Promise<void> {
  try {
    const db = getFirestore()
    const override = (await db.doc('admin_config/app').get()).data() ?? {}
    const lookups: Record<StorePlatform, { source: string; get?: () => Promise<string | null> }> = {
      ios: { source: 'itunes', get: deps.ios },
      android: { source: 'play', get: deps.android },
    }
    const update: Record<string, unknown> = {}
    for (const platform of ['ios', 'android'] as const) {
      const pinned = normaliseVersion(override[platform])
      if (pinned) {
        update[platform] = { version: pinned, source: 'override', checkedAt: FieldValue.serverTimestamp() }
        continue
      }
      const { source, get } = lookups[platform]
      if (!get) continue
      try {
        const version = await get()
        if (version) update[platform] = { version, source, checkedAt: FieldValue.serverTimestamp() }
        else logger.warn('[storeVersions] no version in the answer', { platform })
      } catch (err) {
        // The last good value stays in system/app.
        logger.warn('[storeVersions] lookup failed', { platform, err: String(err) })
      }
    }
    if (Object.keys(update).length === 0) return
    await db.doc('system/app').set(update, { merge: true })
    const summary = Object.fromEntries(Object.entries(update).map(([k, v]) => {
      const { version, source } = v as { version: string; source: string }
      return [k, `${version} (${source})`]
    }))
    logger.info('[storeVersions] updated', summary)
  } catch (err) {
    logger.warn('[storeVersions] refresh failed', { err: String(err) })
  }
}

/** Look up now and every hour. Returns a stop function. */
export function startStoreVersions(): () => void {
  const tick = () => { void refreshStoreVersions() }
  tick()
  const timer = setInterval(tick, EVERY_MS)
  return () => clearInterval(timer)
}
