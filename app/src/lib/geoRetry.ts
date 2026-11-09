// Photos still waiting for their location, remembered on the phone so the
// search resumes when the app is opened again (the first search dies with the
// app). A fix found more than GEO_ATTACH_CAP_MS after the shot is the phone's
// position now, not where the photo was taken, so it is never attached; the
// worker then shows a nearby photo's place instead (borrowPlace.ts).

import type { Geo } from './location'

export const GEO_ATTACH_CAP_MS = 15 * 60_000
const KEY = 'tbp:geoPending'

interface Pending { id: string; at: number }

function read(): Pending[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]') as Pending[]
    return Array.isArray(v) ? v.filter((p) => typeof p?.id === 'string' && typeof p?.at === 'number') : []
  } catch {
    return []
  }
}

function write(list: Pending[]): void {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch { /* storage blocked */ }
}

/** This photo was saved without a location. */
export function noteNeedsGeo(id: string, takenAtMs: number): void {
  write([...read().filter((p) => p.id !== id), { id, at: takenAtMs }])
}

/** This photo has its location now. */
export function clearNeedsGeo(id: string): void {
  write(read().filter((p) => p.id !== id))
}

let running: Promise<void> | null = null

/**
 * Look for a location once for every photo still waiting (within the cap)
 * and attach it. Runs one search at a time; safe to call often.
 */
export function resumeGeoRetries(opts: { find: () => Promise<Geo | null>; attach: (id: string, geo: Geo) => Promise<void>; now?: () => number }): Promise<void> {
  if (running) return running
  const now = opts.now ?? Date.now
  const live = () => read().filter((p) => now() - p.at <= GEO_ATTACH_CAP_MS)
  running = (async () => {
    const waiting = live()
    write(waiting)
    if (!waiting.length) return
    const geo = await opts.find()
    if (!geo) return
    // The search can take a couple of minutes: check the cap again.
    for (const p of live()) {
      try {
        await opts.attach(p.id, geo)
        clearNeedsGeo(p.id)
      } catch (err) {
        console.warn('[geoRetry] location not attached', p.id, err)
      }
    }
  })().catch((err) => console.warn('[geoRetry] failed', err)).finally(() => { running = null })
  return running
}
