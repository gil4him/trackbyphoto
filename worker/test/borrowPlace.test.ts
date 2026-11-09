// A photo without a location shows the place of the same person's closest
// photo within an hour (owner decision, 2026-11-09): the name only, never the
// coordinates or address, and a real location always wins.
import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { backfillBorrowedPlaces, borrowPlaceFor, lendPlace, pickLender } from '../src/handlers/borrowPlace'
import { processMemo, type MemoDeps } from '../src/handlers/memo'
import { locateMemo } from '../src/handlers/place'
import { resetPlansCache } from '../src/plans'
import { resetHomeCache, setTravelGeocoder } from '../src/travel'
import type { PromptHints } from '../src/llm/prompt'
import { db, clearFirestore, count } from './setup'

const T0 = Date.parse('2026-11-01T12:00:00Z')
const min = (n: number) => Timestamp.fromMillis(T0 + n * 60_000)
const memo = async (id: string) => (await db.doc(`memos/${id}`).get()).data()!

/** A finished photo with its own place, `n` minutes from T0. */
const lender = (id: string, n: number, extra: Record<string, unknown> = {}) =>
  db.doc(`memos/${id}`).set({ patientUid: 'p1', takenAt: min(n), lat: 37.5, lng: 127, place: `${id}-place`, address: `${id}-addr`, status: 'ready', ...extra })
/** A finished photo the phone sent without a location. */
const blind = (id: string, n: number, extra: Record<string, unknown> = {}) =>
  db.doc(`memos/${id}`).set({ patientUid: 'p1', takenAt: min(n), lat: null, lng: null, place: '', status: 'ready', ...extra })

function deps(geo = { place: '서초동, 서초구', address: '서울특별시 서초구 서초대로 1' }): MemoDeps & { lastHints: PromptHints | null } {
  const d = {
    lastHints: null as PromptHints | null,
    loadPhoto: async () => ({ photoUrl: 'https://example.test/p.jpg', base64: async () => 'aGk=' }),
    geocode: async () => geo,
    generate: async (args: PromptHints) => {
      d.lastHints = args
      return { activity: '휴식', memo: '집에서 쉬고 계세요.', scene: '조용한 오후예요.', model: 'm', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 } }
    },
  }
  return d
}
const pending = (id: string, n: number, extra: Record<string, unknown> = {}) =>
  db.doc(`memos/${id}`).set({
    patientUid: 'p1', photoPath: `photos/p1/${id}.jpg`, photoUrl: '', takenAt: min(n), lat: null, lng: null,
    place: '', activity: '기타', memo: '', scene: '', status: 'pending', createdAt: Timestamp.now(), ...extra,
  })

beforeEach(async () => {
  await clearFirestore(); resetPlansCache(); resetHomeCache()
  setTravelGeocoder(async () => ({ place: '', address: '' }))
})

describe('borrowed place', () => {
  it('copies the name of a photo 20 minutes earlier, nothing else', async () => {
    await lender('a', -20)
    await blind('me', 0)
    expect(await borrowPlaceFor('me')).toBe('borrowed')
    const m = await memo('me')
    expect(m).toMatchObject({ place: 'a-place', placeFrom: 'a', lat: null, lng: null, status: 'ready' })
    expect(m.address).toBeUndefined()
    expect(await count('notifications', 'type', 'photo.new')).toBe(0)
  })

  it('the nearer photo wins, before or after; the earlier one on a tie', async () => {
    await lender('before', -25)
    await lender('after', 10)
    await blind('me', 0)
    await borrowPlaceFor('me')
    expect((await memo('me')).placeFrom).toBe('after')
    const tie = pickLender(T0, [
      { id: 'late', data: { lat: 1, lng: 1, place: 'L', takenAt: min(5) } },
      { id: 'early', data: { lat: 1, lng: 1, place: 'E', takenAt: min(-5) } },
    ])
    expect(tie?.id).toBe('early')
  })

  it('never from too far, without a place, a borrowed place, another person or an unfinished lookup', async () => {
    await lender('far', -61)
    await lender('noPlace', -5, { place: '' })
    await lender('chained', -4, { lat: null, lng: null, placeFrom: 'x' })
    await lender('other', -3, { patientUid: 'p2' })
    await lender('looking', -2, { needsGeocode: true })
    await blind('me', 0)
    expect(await borrowPlaceFor('me')).toBe('none')
    expect((await memo('me')).place).toBe('')
  })

  it('leaves a photo with its own place, its own coordinates, or an error alone', async () => {
    await lender('a', -5)
    await blind('own', 0, { place: '집 근처' })
    await blind('coords', 1, { lat: 37.5, lng: 127 })
    await blind('broken', 2, { status: 'error' })
    for (const id of ['own', 'coords', 'broken']) expect(await borrowPlaceFor(id)).toBe('none')
    expect((await memo('own')).place).toBe('집 근처')
  })

  it('is off only when the flag says false', async () => {
    await db.doc('admin_config/plans').set({ flags: { borrowPlace: false } })
    resetPlansCache()
    await lender('a', -5)
    await blind('me', 0)
    expect(await borrowPlaceFor('me')).toBe('off')
    expect((await memo('me')).place).toBe('')
  })

  it('a photo that gets its place later fills the photos around it', async () => {
    await blind('me', 0)
    expect(await borrowPlaceFor('me')).toBe('none')
    await lender('a', 30)
    expect(await lendPlace('a')).toBe(1)
    expect((await memo('me')).placeFrom).toBe('a')
  })

  it('a late real location replaces the borrowed place, and a trip still gets the memo rewritten', async () => {
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 37.48, lng: 127.01 } })
    await lender('a', -10, { memoSource: 'cloud-llm' })
    await blind('me', 0, { memoSource: 'cloud-llm' })
    await borrowPlaceFor('me')
    await db.doc('memos/me').update({ lat: 34.86, lng: 136.82, needsGeocode: true })
    expect(await locateMemo('me', async () => ({ place: 'FamilyMart · 도코나메시, 일본', address: '' }))).toBe('done')
    const m = await memo('me')
    expect(m.place).toBe('FamilyMart · 도코나메시, 일본')
    expect(m.placeFrom).toBeUndefined()
    expect(m.status).toBe('pending')
  })
})

describe('in the memo pipeline', () => {
  it('a photo without a location is written as if the place were unknown, then shows the borrowed place', async () => {
    await lender('a', -40)
    await pending('me', 0)
    const d = deps()
    expect(await processMemo('me', 1, d)).toBe('done')
    expect(d.lastHints?.placeHint).toBeUndefined()
    expect(d.lastHints?.placeFull).toBeUndefined()
    expect(await memo('me')).toMatchObject({ status: 'ready', place: 'a-place', placeFrom: 'a' })
  })

  it('a located photo lends its fresh place to a blind neighbour', async () => {
    await blind('me', 0)
    await pending('a', 15, { lat: 37.5, lng: 127 })
    await processMemo('a', 1, deps())
    expect(await memo('me')).toMatchObject({ place: '서초동, 서초구', placeFrom: 'a' })
  })
})

describe('backfill', () => {
  it('reports without writing, then fills with apply', async () => {
    await db.doc('memos/a').set({ patientUid: 'p1', takenAt: Timestamp.fromMillis(Date.now() - 3_600_000), lat: 1, lng: 1, place: 'P', status: 'ready' })
    await db.doc('memos/me').set({ patientUid: 'p1', takenAt: Timestamp.fromMillis(Date.now() - 3_000_000), lat: null, lng: null, place: '', status: 'ready' })
    const dry = await backfillBorrowedPlaces({ sinceDays: 1, apply: false })
    expect(dry.map((r) => [r.id, r.from, r.gapMin])).toEqual([['me', 'a', 10]])
    expect((await memo('me')).place).toBe('')
    await backfillBorrowedPlaces({ sinceDays: 1, apply: true })
    expect((await memo('me')).placeFrom).toBe('a')
  })
})
