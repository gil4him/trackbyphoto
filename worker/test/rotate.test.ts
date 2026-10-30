// 사진 돌리기: baking a memo's pending rotation into the stored photo.
// Storage and sharp are injected fakes; Firestore is the real emulator.
import { describe, it, expect, beforeEach } from 'vitest'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { normalizeRotation, rotateMemo, type RotateDeps } from '../src/handlers/rotate'
import { db, clearFirestore } from './setup'

function fakes(over: Partial<RotateDeps> = {}) {
  const f = { loads: 0, stores: 0, thumbs: 0, turns: [] as number[] }
  const deps: RotateDeps = {
    load: async () => { f.loads++; return Buffer.from('jpeg') },
    turn: async (bytes, deg) => { f.turns.push(deg); return Buffer.concat([bytes, Buffer.from(`+${deg}`)]) },
    store: async (path) => { f.stores++; return `https://example.test/${path}?token=new${f.stores}` },
    thumbOf: async (path) => { f.thumbs++; return `https://example.test/${path}.thumb?token=new${f.thumbs}` },
    ...over,
  }
  return { f, deps }
}
const seed = (id: string, extra: Record<string, unknown> = {}) => db.doc(`memos/${id}`).set({
  patientUid: 'p1', photoPath: `photos/p1/${id}.jpg`, photoUrl: 'https://example.test/old', thumbUrl: 'https://example.test/old.thumb',
  status: 'ready', createdAt: Timestamp.now(), ...extra,
})
const memo = async (id: string) => (await db.doc(`memos/${id}`).get()).data()!

beforeEach(async () => { await clearFirestore() })

describe('normalizeRotation', () => {
  it('folds any degrees into a clockwise quarter turn', () => {
    expect([0, 90, 180, 270, 360, 450, -90, 89, 1000].map(normalizeRotation)).toEqual([0, 90, 180, 270, 0, 90, 270, 90, 270])
  })
})

describe('rotateMemo', () => {
  it('bakes 90 degrees: new links, field cleared, rotatedAt stamped', async () => {
    await seed('a', { rotation: 90 })
    const { f, deps } = fakes()
    expect(await rotateMemo('a', deps)).toBe('done')
    const m = await memo('a')
    expect(f.turns).toEqual([90])
    expect(m.photoUrl).toBe('https://example.test/photos/p1/a.jpg?token=new1')
    expect(m.thumbUrl).toBe('https://example.test/photos/p1/a.jpg.thumb?token=new1')
    expect(m.rotation).toBeUndefined()
    expect(m.rotatedAt).toBeInstanceOf(Timestamp)
  })

  it('bakes 450 as 90', async () => {
    await seed('a', { rotation: 450 })
    const { f, deps } = fakes()
    expect(await rotateMemo('a', deps)).toBe('done')
    expect(f.turns).toEqual([90])
    expect((await memo('a')).rotation).toBeUndefined()
  })

  it('drops a junk or full-circle request without touching Storage', async () => {
    for (const [id, rotation] of [['x', 'x'], ['z', 0], ['f', 360]] as const) {
      await seed(id, { rotation })
      const { f, deps } = fakes()
      expect(await rotateMemo(id, deps)).toBe('done')
      expect(f).toMatchObject({ loads: 0, stores: 0, thumbs: 0 })
      const m = await memo(id)
      expect(m.rotation).toBeUndefined()
      expect(m.photoUrl).toBe('https://example.test/old')
      expect(m.rotatedAt).toBeUndefined()
    }
  })

  it('keeps a tap made mid-bake pending and asks to go again', async () => {
    await seed('a', { rotation: 90 })
    const { f, deps } = fakes()
    const store = deps.store
    deps.store = async (path, bytes) => {
      await db.doc('memos/a').update({ rotation: FieldValue.increment(90) })
      return store(path, bytes)
    }
    expect(await rotateMemo('a', deps)).toBe('again')
    const m = await memo('a')
    expect(m.rotation).toBe(90)
    expect(m.photoUrl).toBe('https://example.test/photos/p1/a.jpg?token=new1')
    expect(await rotateMemo('a', deps)).toBe('again') // the fake taps again every time
    deps.store = store
    expect(await rotateMemo('a', deps)).toBe('done')
    expect(f.turns).toEqual([90, 90, 90])
    expect((await memo('a')).rotation).toBeUndefined()
  })

  it('a thumbnail that fails drops the old thumbnail link and keeps the new photo', async () => {
    await seed('a', { rotation: 180 })
    const { deps } = fakes({ thumbOf: async () => { throw new Error('sharp exploded') } })
    expect(await rotateMemo('a', deps)).toBe('done')
    const m = await memo('a')
    expect(m.thumbUrl).toBeUndefined()
    expect(m.photoUrl).toBe('https://example.test/photos/p1/a.jpg?token=new1')
    expect(m.rotation).toBeUndefined()
  })

  it('a missing photo clears the request', async () => {
    await seed('a', { rotation: 90 })
    const { f, deps } = fakes({ load: async () => null })
    expect(await rotateMemo('a', deps)).toBe('done')
    expect(f.stores).toBe(0)
    const m = await memo('a')
    expect(m.rotation).toBeUndefined()
    expect(m.photoUrl).toBe('https://example.test/old')
  })

  it('a photo outside the owner folder is never touched', async () => {
    await seed('a', { rotation: 90, photoPath: 'photos/someone_else/a.jpg' })
    const { f, deps } = fakes()
    expect(await rotateMemo('a', deps)).toBe('done')
    expect(f.loads).toBe(0)
    expect((await memo('a')).rotation).toBeUndefined()
  })

  it('a failure leaves the request for a retry', async () => {
    await seed('a', { rotation: 90 })
    const { deps } = fakes({ store: async () => { throw new Error('storage down') } })
    expect(await rotateMemo('a', deps)).toBe('retry')
    const m = await memo('a')
    expect(m.rotation).toBe(90)
    expect(m.photoUrl).toBe('https://example.test/old')
  })
})
