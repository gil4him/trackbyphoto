import { describe, it, expect, beforeEach } from 'vitest'
import { fromStored, memoryStore, Outbox, toStored, type OutboxBackend, type OutboxItem, type OutboxStore } from './outbox'

const SEOUL = { lat: 37.48, lng: 127.01 }

/** A server we can switch off, recording what reached it. */
function fakeServer() {
  const s = {
    online: true,
    uploads: [] as string[],
    memos: new Map<string, { lat: number | null; lng: number | null }>(),
    patches: [] as { photoId: string; lat: number; lng: number }[],
    backend: null as unknown as OutboxBackend,
  }
  const need = () => { if (!s.online) throw new Error('offline') }
  s.backend = {
    upload: async (item) => { need(); s.uploads.push(item.photoId) },
    memoExists: async (item) => { need(); return s.memos.has(item.photoId) },
    createMemo: async (item) => { need(); s.memos.set(item.photoId, { lat: item.lat, lng: item.lng }) },
    patchGeo: async (photoId, geo) => { need(); s.patches.push({ photoId, ...geo }) },
  }
  return s
}

let clock: number
let store: OutboxStore
let server: ReturnType<typeof fakeServer>
let outbox: Outbox

const photo = (photoId: string, extra: Partial<OutboxItem> = {}) => ({
  photoId, uid: 'u1', blob: new Blob(['x']), ext: 'jpg', takenAtMs: clock,
  lat: SEOUL.lat as number | null, lng: SEOUL.lng as number | null, tzOffsetMin: 540, tags: null, ...extra,
})
const noGeo = { lat: null, lng: null }

beforeEach(() => {
  clock = 1_000_000
  store = memoryStore()
  server = fakeServer()
  outbox = new Outbox(store, server.backend, {
    now: () => clock,
    sleep: async (ms) => { clock += ms },
    geoWaitMs: 10_000,
  })
})

describe('outbox', () => {
  it('sends a photo and clears it from the phone', async () => {
    await outbox.enqueue(photo('a'))
    await outbox.flush('u1')
    expect(server.uploads).toEqual(['a'])
    expect(server.memos.get('a')).toEqual(SEOUL)
    expect(await store.all()).toEqual([])
  })

  it('keeps the photo while offline and sends it when the connection returns', async () => {
    server.online = false
    await outbox.enqueue(photo('a'))
    await outbox.flush('u1')
    const [kept] = await store.all()
    expect(kept.attempts).toBeGreaterThan(0)
    expect(kept.nextTryAt).toBeGreaterThan(clock)
    expect(server.memos.size).toBe(0)

    // Not due yet: a plain flush leaves it alone.
    server.online = true
    await outbox.flush('u1')
    expect(server.memos.size).toBe(0)

    await outbox.retryNow('u1')
    expect(server.memos.has('a')).toBe(true)
    expect(await store.all()).toEqual([])
  })

  it('does not upload twice when only the memo step failed', async () => {
    const createMemo = server.backend.createMemo
    server.backend.createMemo = async () => { throw new Error('timed out') }
    await outbox.enqueue(photo('a'))
    await outbox.flush('u1')
    server.backend.createMemo = createMemo
    await outbox.retryNow('u1')
    expect(server.uploads).toEqual(['a'])
    expect(server.memos.has('a')).toBe(true)
  })

  it('does not recreate a memo that an earlier attempt already delivered', async () => {
    server.memos.set('a', { lat: 1, lng: 2 }) // reached the server; the reply was lost
    await outbox.enqueue(photo('a'))
    await outbox.flush('u1')
    expect(server.memos.get('a')).toEqual({ lat: 1, lng: 2 })
    expect(await store.all()).toEqual([])
  })

  it('waits briefly for a location, then sends without one', async () => {
    await outbox.enqueue(photo('a', noGeo))
    await outbox.flush('u1')
    expect(server.memos.get('a')).toEqual(noGeo)
    expect(clock).toBeGreaterThanOrEqual(1_000_000 + 10_000)
  })

  it('includes a location that arrives while the photo is still queued', async () => {
    server.online = false
    await outbox.enqueue(photo('a', noGeo))
    await outbox.flush('u1')
    await outbox.attachGeo('a', SEOUL)
    server.online = true
    await outbox.retryNow('u1')
    expect(server.memos.get('a')).toEqual(SEOUL)
    expect(server.patches).toEqual([])
  })

  it('patches the memo when the location arrives after sending', async () => {
    await outbox.enqueue(photo('a', noGeo))
    await outbox.flush('u1')
    await outbox.attachGeo('a', SEOUL)
    expect(server.patches).toEqual([{ photoId: 'a', ...SEOUL }])
  })

  it("leaves another account's photos alone", async () => {
    await outbox.enqueue(photo('mine'))
    await store.put({ ...photo('theirs', { uid: 'u2' }), uploaded: false, attempts: 0, nextTryAt: 0 })
    await outbox.flush('u1')
    expect(server.uploads).toEqual(['mine'])
    expect((await store.all()).map((i) => i.photoId)).toEqual(['theirs'])
  })

  it('sends oldest first and tells listeners as the queue empties', async () => {
    const seen: number[] = []
    outbox.subscribe((items) => seen.push(items.length))
    server.online = false
    await outbox.enqueue(photo('new', { takenAtMs: 2 }))
    await outbox.enqueue(photo('old', { takenAtMs: 1 }))
    server.online = true
    await outbox.retryNow('u1')
    expect(server.uploads.slice(-2)).toEqual(['old', 'new'])
    expect(seen.at(-1)).toBe(0)
  })

  it('records why the last try failed', async () => {
    server.online = false
    await outbox.enqueue(photo('a'))
    await outbox.flush('u1')
    expect((await store.all())[0].lastError).toBe('offline')
  })

  it('carries on with the other photos when one cannot even be put back', async () => {
    server.online = false
    await outbox.enqueue(photo('bad', { takenAtMs: 1 }))
    await outbox.enqueue(photo('good', { takenAtMs: 2 }))
    server.online = true
    const put = store.put
    store.put = async (item) => { if (item.photoId === 'bad') throw new Error('disk'); return put(item) }
    server.backend.upload = async (item) => {
      if (item.photoId === 'bad') throw new Error('unreadable')
      server.uploads.push(item.photoId)
    }
    await outbox.retryNow('u1')
    expect(server.memos.has('good')).toBe(true)
  })
})

describe('an upload that stops moving', () => {
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const quick = () => new Outbox(store, server.backend, { now: () => clock, sleep: async (ms) => { clock += ms }, stallMs: 30 })

  it('is given up on, stopped, and does not hold up the photos behind it', async () => {
    let stopped = false
    server.backend.upload = (item, watch) => {
      if (item.photoId !== 'dead') { server.uploads.push(item.photoId); return Promise.resolve() }
      // Neither finishes nor fails: a connection that went quiet.
      watch.signal.addEventListener('abort', () => { stopped = true })
      return new Promise(() => {})
    }
    const box = quick()
    await store.put({ ...photo('dead', { takenAtMs: 1 }), uploaded: false, attempts: 0, nextTryAt: 0 })
    await store.put({ ...photo('next', { takenAtMs: 2 }), uploaded: false, attempts: 0, nextTryAt: 0 })
    await box.flush('u1')
    expect(stopped).toBe(true)
    expect(server.memos.has('next')).toBe(true)
    const [kept] = await store.all()
    expect(kept).toMatchObject({ photoId: 'dead', attempts: 1, lastError: 'upload stalled' })
    expect(kept.nextTryAt).toBeGreaterThan(clock)
  })

  it('goes through on the next try, in the same app session', async () => {
    let tries = 0
    server.backend.upload = (item) => {
      tries += 1
      if (tries === 1) return new Promise(() => {})
      server.uploads.push(item.photoId)
      return Promise.resolve()
    }
    const box = quick()
    await store.put({ ...photo('a'), uploaded: false, attempts: 0, nextTryAt: 0 })
    await box.flush('u1')
    expect(server.memos.size).toBe(0)
    await box.retryNow('u1')
    expect(server.memos.has('a')).toBe(true)
    expect(await store.all()).toEqual([])
  })

  it('is retried at once when the connection returns while a try is failing', async () => {
    let fail: (err: Error) => void = () => {}
    let tries = 0
    server.backend.upload = (item) => {
      tries += 1
      if (tries === 1) return new Promise((_, reject) => { fail = reject })
      server.uploads.push(item.photoId)
      return Promise.resolve()
    }
    await store.put({ ...photo('a'), uploaded: false, attempts: 0, nextTryAt: 0 })
    const run = outbox.flush('u1')
    await tick(5)
    const back = outbox.retryNow('u1') // "online" fires while the old request is still dying
    fail(new Error('network error'))
    await Promise.all([run, back])
    expect(server.memos.has('a')).toBe(true)
  })

  it('is left alone while it is slow but still moving', async () => {
    server.backend.upload = async (item, watch) => {
      for (let i = 0; i < 6; i++) { await tick(15); watch.progress() } // 90 ms in all, never 30 ms quiet
      server.uploads.push(item.photoId)
    }
    const box = quick()
    await store.put({ ...photo('slow'), uploaded: false, attempts: 0, nextTryAt: 0 })
    await box.flush('u1')
    expect(server.memos.has('slow')).toBe(true)
    expect(await store.all()).toEqual([])
  })
})

describe('what is kept on the phone', () => {
  const item: OutboxItem = {
    photoId: 'a', uid: 'u1', blob: new Blob(['photo-bytes'], { type: 'image/jpeg' }), ext: 'jpg', takenAtMs: 5,
    lat: null, lng: null, tzOffsetMin: 540, tags: null, uploaded: false, attempts: 0, nextTryAt: 0,
  }

  it('is the plain bytes of the file, and comes back as the same file', async () => {
    const rec = await toStored(item)
    expect('blob' in rec).toBe(false)
    expect((rec as { bytes: ArrayBuffer }).bytes.byteLength).toBe(11)
    const back = fromStored(rec)
    expect(back.blob.type).toBe('image/jpeg')
    expect(await back.blob.text()).toBe('photo-bytes')
    expect(back).toMatchObject({ photoId: 'a', uid: 'u1', takenAtMs: 5, attempts: 0 })
  })

  it('still reads an entry saved by an earlier version', () => {
    expect(fromStored(item)).toBe(item)
  })

  it('keeps an entry whose file can no longer be read, rather than failing', async () => {
    const broken = { ...item, blob: { type: 'image/jpeg', arrayBuffer: async () => { throw new Error('NotReadableError') } } as unknown as Blob }
    expect(await toStored(broken)).toBe(broken)
  })
})
