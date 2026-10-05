// On-phone outbox for photos.
//
// A photo is saved here the moment it is taken and sent from here, so a weak
// or missing connection never loses it: sending is retried with backoff, when
// the connection comes back, and when the app is opened again.
//
// Sending one photo:
//   1. upload the file (same path every time, so a retry just overwrites),
//   2. give the phone a moment to find its location,
//   3. create the memo doc, unless an earlier attempt already got through,
//   4. drop the photo from the outbox.
// An upload has to keep moving: one that goes quiet is given up on and tried
// again later, so a dead connection can never hold up the photos behind it.
// A location found later is attached to the outbox entry, or to the memo doc
// when the photo has already been sent.
//
// This file knows nothing about Firebase or IndexedDB; see outboxBackend.ts.

import type { Geo } from './location'

export interface OutboxItem {
  /** Also the memo doc id and the file name. */
  photoId: string
  uid: string
  blob: Blob
  ext: string
  takenAtMs: number
  lat: number | null
  lng: number | null
  /** The phone's UTC offset in minutes when the photo was taken. */
  tzOffsetMin: number
  tags: unknown | null
  uploaded: boolean
  attempts: number
  nextTryAt: number
  /** Why the last attempt failed; shown when a photo has waited a long time. */
  lastError?: string
}

/** The outbox's hold on an upload in progress. */
export interface UploadWatch {
  /** Call whenever bytes have moved. */
  progress(): void
  /** Aborted when the outbox gives up on this attempt. */
  signal: AbortSignal
}

export interface OutboxStore {
  put(item: OutboxItem): Promise<void>
  get(photoId: string): Promise<OutboxItem | undefined>
  all(): Promise<OutboxItem[]>
  delete(photoId: string): Promise<void>
}

// What is kept in IndexedDB: the file as plain bytes. Some iPhone versions
// lose a Blob kept there once the app has been closed, which would leave a
// photo that can be seen in the list but never sent.
export type Stored = Omit<OutboxItem, 'blob'> & { bytes: ArrayBuffer; type: string }

export async function toStored(item: OutboxItem): Promise<Stored | OutboxItem> {
  const { blob, ...rest } = item
  try {
    return { ...rest, bytes: await blob.arrayBuffer(), type: blob.type }
  } catch (err) {
    // An entry from an earlier version whose Blob can't be read: keep it as
    // it is, so the rest of the outbox carries on around it.
    console.warn('[outbox] could not read a waiting file', item.photoId, err)
    return item
  }
}

/** Entries saved by earlier versions hold a Blob and are returned as they are. */
export function fromStored(rec: Stored | OutboxItem): OutboxItem {
  if (!('bytes' in rec)) return rec
  const { bytes, type, ...rest } = rec
  return { ...rest, blob: new Blob([bytes], { type }) }
}

export interface OutboxBackend {
  upload(item: OutboxItem, watch: UploadWatch): Promise<void>
  memoExists(item: OutboxItem): Promise<boolean>
  createMemo(item: OutboxItem): Promise<void>
  /** Attach a location to a memo that was already sent. */
  patchGeo(photoId: string, geo: Geo): Promise<void>
}

export interface OutboxOptions {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** How long after the shutter to hold the memo back waiting for a location. */
  geoWaitMs?: number
  /** How long an upload may go without moving before it is given up on. */
  stallMs?: number
}

const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000]

export function memoryStore(): OutboxStore {
  const items = new Map<string, OutboxItem>()
  return {
    put: async (item) => { items.set(item.photoId, { ...item }) },
    get: async (id) => { const i = items.get(id); return i ? { ...i } : undefined },
    all: async () => [...items.values()].map((i) => ({ ...i })),
    delete: async (id) => { items.delete(id) },
  }
}

/** A short name for a failure: the SDK's code when there is one. */
function describe(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown; message?: unknown } | null
  const text = [e?.code, e?.name, e?.message].find((v) => typeof v === 'string' && v && v !== 'Error')
  return String(text ?? err).slice(0, 80)
}

export class Outbox {
  private listeners = new Set<(items: OutboxItem[]) => void>()
  private current: Promise<void> | null = null
  private again = false
  /** Counts retryNow calls, so a try that fails across one is retried at once. */
  private retries = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private lock: Promise<unknown> = Promise.resolve()
  private store: OutboxStore
  private backend: OutboxBackend
  private now: () => number
  private sleep: (ms: number) => Promise<void>
  private geoWaitMs: number
  private stallMs: number

  constructor(store: OutboxStore, backend: OutboxBackend, opts: OutboxOptions = {}) {
    this.store = store
    this.backend = backend
    this.now = opts.now ?? Date.now
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.geoWaitMs = opts.geoWaitMs ?? 10_000
    this.stallMs = opts.stallMs ?? 120_000
  }

  /** Serialise changes to an entry so a late location can't race the send. */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn)
    this.lock = next.catch(() => {})
    return next
  }

  subscribe(listener: (items: OutboxItem[]) => void): () => void {
    this.listeners.add(listener)
    void this.emit()
    return () => { this.listeners.delete(listener) }
  }

  private async emit() {
    const items = (await this.store.all()).sort((a, b) => b.takenAtMs - a.takenAtMs)
    for (const l of this.listeners) l(items)
  }

  async enqueue(item: Omit<OutboxItem, 'uploaded' | 'attempts' | 'nextTryAt'>): Promise<void> {
    await this.store.put({ ...item, uploaded: false, attempts: 0, nextTryAt: 0 })
    await this.emit()
    void this.flush(item.uid)
  }

  /** The phone found where the photo was taken. */
  async attachGeo(photoId: string, geo: Geo): Promise<void> {
    const stillQueued = await this.withLock(async () => {
      const item = await this.store.get(photoId)
      if (!item) return false
      await this.store.put({ ...item, lat: geo.lat, lng: geo.lng })
      return true
    })
    if (!stillQueued) await this.backend.patchGeo(photoId, geo)
  }

  /** The connection may be back: try everything now instead of waiting. */
  async retryNow(uid: string): Promise<void> {
    this.retries += 1
    await this.withLock(async () => {
      for (const item of await this.store.all()) {
        if (item.uid === uid && item.nextTryAt > 0) await this.store.put({ ...item, nextTryAt: 0 })
      }
    })
    await this.flush(uid)
  }

  /** Send every due photo of this user, oldest first. A call made while a
   *  run is in progress extends that run and resolves when it ends. */
  flush(uid: string): Promise<void> {
    if (this.current) { this.again = true; return this.current }
    this.current = (async () => {
      try {
        do {
          this.again = false
          const due = (await this.store.all())
            .filter((i) => i.uid === uid && i.nextTryAt <= this.now())
            .sort((a, b) => a.takenAtMs - b.takenAtMs)
          for (const item of due) {
            // Whatever goes wrong with one photo, the others still get their turn.
            await this.send(item.photoId).catch((err) => console.warn('[outbox] send not recorded', item.photoId, err))
          }
        } while (this.again)
      } catch (err) {
        console.warn('[outbox] run failed; will try again', err)
      } finally {
        this.current = null
      }
      await this.schedule(uid).catch((err) => console.warn('[outbox] next try not scheduled', err))
    })()
    return this.current
  }

  private async schedule(uid: string) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    const waiting = (await this.store.all()).filter((i) => i.uid === uid)
    if (waiting.length === 0) return
    const next = Math.min(...waiting.map((i) => i.nextTryAt))
    this.timer = setTimeout(() => { void this.flush(uid) }, Math.max(1_000, next - this.now()))
  }

  /** Upload, but never wait on a connection that has gone quiet: without
   *  this, an upload that neither finishes nor fails would block every later
   *  photo until the app is restarted. */
  private upload(item: OutboxItem): Promise<void> {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let over = false
    return new Promise<void>((resolve, reject) => {
      const arm = () => {
        if (over) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          reject(new Error('upload stalled'))
          abort.abort()
        }, this.stallMs)
      }
      arm()
      this.backend.upload(item, { progress: arm, signal: abort.signal }).then(resolve, reject)
    }).finally(() => {
      over = true
      clearTimeout(timer)
    })
  }

  private async send(photoId: string): Promise<void> {
    const startedAt = this.retries
    try {
      let item = await this.store.get(photoId)
      if (!item) return
      if (!item.uploaded) {
        await this.upload(item)
        await this.withLock(async () => {
          const fresh = await this.store.get(photoId)
          if (fresh) await this.store.put({ ...fresh, uploaded: true })
        })
      }

      // The memo is written from what's in the doc when the worker picks it
      // up, so hold on briefly for the location rather than send without it.
      for (;;) {
        item = await this.store.get(photoId)
        if (!item) return
        if (item.lat != null || this.now() - item.takenAtMs >= this.geoWaitMs) break
        await this.sleep(500)
      }

      const sent = item
      // An earlier attempt may have reached the server without our hearing
      // back. Creating it again would reset a memo the worker already wrote.
      if (!(await this.backend.memoExists(sent))) await this.backend.createMemo(sent)

      const late = await this.withLock(async () => {
        const fresh = await this.store.get(photoId)
        await this.store.delete(photoId)
        return fresh && fresh.lat != null && fresh.lng != null && sent.lat == null
          ? { lat: fresh.lat, lng: fresh.lng }
          : null
      })
      if (late) await this.backend.patchGeo(photoId, late).catch((err) => console.warn('[outbox] late location not attached', err))
    } catch (err) {
      console.warn('[outbox] send failed; will retry', photoId, err)
      await this.withLock(async () => {
        const item = await this.store.get(photoId)
        if (!item) return
        const attempts = item.attempts + 1
        // The connection may have come back while this try was failing: then
        // don't make the photo sit out a wait that was meant for the old one.
        const delay = this.retries !== startedAt ? 0 : BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
        await this.store.put({ ...item, attempts, nextTryAt: delay ? this.now() + delay : 0, lastError: describe(err) })
      })
    }
    await this.emit()
  }
}
