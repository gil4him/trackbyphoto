import { describe, it, expect, beforeEach } from 'vitest'
import { memoryStore, Outbox, type OutboxBackend, type OutboxItem, type OutboxStore } from './outbox'

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
})
