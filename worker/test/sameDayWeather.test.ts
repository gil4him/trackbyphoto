// A photo without a location borrows that day's closest photo's location for
// its weather, and only for its weather.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
const weatherAt = vi.hoisted(() => vi.fn(async () => ({ code: 'clear', label: '맑음', tempC: 20 })))
vi.mock('../src/weather', async (orig) => ({ ...(await orig<object>()), weatherAt }))
import { momentHintsFor } from '../src/handlers/memo'
import { db, clearFirestore } from './setup'

const at = (s: string) => new Date(`${s}:00Z`)
const seed = (id: string, when: string, lat: number | null, lng: number | null) =>
  db.doc(`memos/${id}`).set({ patientUid: 'p1', takenAt: Timestamp.fromDate(at(when)), lat, lng, status: 'ready' })
const hints = (takenAt: Date, lat: number | null = null, lng: number | null = null) =>
  momentHintsFor({ memoId: 'me', patientUid: 'p1', takenAt, lat, lng, tzOffsetMin: 0 })

beforeEach(async () => { await clearFirestore(); weatherAt.mockClear(); await db.doc('users/p1').set({ patientName: '엄마' }) })

describe('weather of a photo without a location', () => {
  it('its own spot comes first', async () => {
    await seed('a', '2026-10-01T10:00', 1, 2)
    await hints(at('2026-10-01T12:00'), 5, 6)
    expect(weatherAt).toHaveBeenCalledWith(5, 6, at('2026-10-01T12:00'))
  })
  it('uses the closest photo of the same day, at this photo\'s time', async () => {
    await seed('far', '2026-10-01T01:00', 1, 2)
    await seed('near', '2026-10-01T11:00', 3, 4)
    await seed('noGps', '2026-10-01T11:50', null, null)
    const h = await hints(at('2026-10-01T12:00'))
    expect(weatherAt).toHaveBeenCalledWith(3, 4, at('2026-10-01T12:00'))
    expect(h.weather).toMatchObject({ label: '맑음' })
  })
  it('never another day\'s photo, even a close one', async () => {
    await seed('yesterday', '2026-09-30T23:50', 1, 2)
    const h = await hints(at('2026-10-01T00:10'))
    expect(weatherAt).not.toHaveBeenCalled()
    expect(h.weather).toBeUndefined()
  })
  it('never home by default', async () => {
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 9, lng: 9 } })
    await hints(at('2026-10-01T12:00'))
    expect(weatherAt).not.toHaveBeenCalled()
  })
})
