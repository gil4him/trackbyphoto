// Memo v2 context pack: the hooks over plain data, and the loader on the emulator.
import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { buildHooks, KOREAN_DAYS, loadContextData, localDayKey, recentTitles, type ContextData, type PastMemo, type PhotoCtx } from '../src/llm/context'
import { db, clearFirestore } from './setup'

const KST = 9 * 60
const at = (iso: string) => new Date(`${iso}+09:00`).getTime()
const past = (id: string, iso: string, o: Partial<PastMemo> = {}): PastMemo =>
  ({ id, takenAtMs: at(iso), activity: '산책', memo: `${id} 제목`, lat: 37.5, lng: 127.0, labels: [], ...o })
const photo = (iso: string, o: Partial<PhotoCtx> = {}): PhotoCtx => ({ takenAtMs: at(iso), lat: 37.5, lng: 127.0, tzOffsetMin: KST, labels: [], ...o })
const data = (items: PastMemo[], style: ContextData['style'] = 'warm'): ContextData => ({ past: [...items].sort((a, b) => b.takenAtMs - a.takenAtMs), style })
const ids = (h: { id: string }[]) => h.map((x) => x.id)
const text = (h: { id: string; text: string }[], id: string) => h.find((x) => x.id === id)?.text

describe('buildHooks', () => {
  it('counts today on the photographer\'s clock, lists the morning\'s titles, and always knows the weekday', () => {
    // 23:30 KST on the 12th is still the 12th there, though the 13th in UTC.
    const h = buildHooks(data([past('a', '2026-10-12T09:00'), past('b', '2026-10-12T12:00'), past('c', '2026-10-11T12:00')]), photo('2026-10-12T23:30', { lat: null, lng: null }), '기타')
    expect(text(h, 'nth')).toBe('오늘 3번째 사진이에요')
    expect(text(h, 'today')).toBe('오늘 앞서 남긴 기록: "a 제목", "b 제목"')
    expect(text(h, 'calendar')).toBe('오늘은 월요일이에요')
    expect(ids(h)).not.toContain('revisit')
  })

  it('has no count for the first photo of the day, and skips stub titles', () => {
    const h = buildHooks(data([past('a', '2026-10-11T12:00', { memo: '사진을 남겼어요' })]), photo('2026-10-12T09:00', { lat: null, lng: null }), '기타')
    expect(ids(h)).not.toContain('nth')
    expect(ids(h)).not.toContain('today')
    expect(recentTitles([past('x', '2026-10-11T12:00', { memo: '사진을 기록했어요.' }), past('y', '2026-10-10T12:00')])).toEqual(['y 제목'])
  })

  it('sees a streak of the same activity on the days right before, and its break', () => {
    const walks = [past('a', '2026-10-11T08:00'), past('b', '2026-10-10T08:00'), past('c', '2026-10-09T08:00', { activity: '식사' })]
    expect(text(buildHooks(data(walks), photo('2026-10-12T08:00'), '산책'), 'streak')).toBe('3일째 이어지는 산책이에요')
    expect(ids(buildHooks(data(walks), photo('2026-10-12T08:00'), '식사'))).not.toContain('streak')
    expect(ids(buildHooks(data([past('a', '2026-10-10T08:00')]), photo('2026-10-12T08:00'), '산책'))).not.toContain('streak')
    expect(ids(buildHooks(data(walks), photo('2026-10-12T08:00'), '기타'))).not.toContain('streak')
  })

  it('remembers a place within 200 m from another day, with its date and title', () => {
    const near = past('a', '2026-09-30T15:00', { lat: 37.5015, lng: 127.0 }) // ~170 m north
    const far = past('b', '2026-10-01T15:00', { lat: 37.503, lng: 127.0 }) // ~330 m
    const sameDay = past('c', '2026-10-12T08:00', { lat: 37.5, lng: 127.0 })
    const h = buildHooks(data([near, far, sameDay]), photo('2026-10-12T15:00'), '산책')
    expect(text(h, 'revisit')).toBe('9월 30일에도 이 근처에 오셨어요: "a 제목"')
    expect(ids(buildHooks(data([far]), photo('2026-10-12T15:00'), '산책'))).not.toContain('revisit')
  })

  it('claims a seasonal first only when the window reaches far enough back', () => {
    const p = photo('2026-04-05T10:00', { labels: ['cherry blossom', 'tree'] })
    const lastYear = [past('a', '2025-12-20T10:00'), past('b', '2026-03-01T10:00')]
    expect(text(buildHooks(data(lastYear), p, '자연'), 'first')).toBe('올해 처음 보는 벚꽃이에요')
    const sixWeeks = [past('a', '2026-02-20T10:00'), past('b', '2026-03-01T10:00')]
    expect(text(buildHooks(data(sixWeeks), p, '자연'), 'first')).toBe('오랜만에 보는 벚꽃이에요')
    const thisWeek = [past('a', '2026-04-01T10:00')]
    expect(ids(buildHooks(data(thisWeek), p, '자연'))).not.toContain('first')
    const seenBefore = [past('a', '2025-12-20T10:00', { labels: ['blossom'] })]
    expect(ids(buildHooks(data(seenBefore), p, '자연'))).not.toContain('first')
    expect(ids(buildHooks(data([]), p, '자연'))).not.toContain('first')
  })

  it('names the day from the Korean calendar, and adds the weather only when given', () => {
    expect(text(buildHooks(data([]), photo('2026-05-08T10:00'), '기타'), 'calendar')).toBe('오늘은 어버이날, 금요일이에요')
    expect(text(buildHooks(data([]), photo('2027-02-07T10:00'), '기타'), 'calendar')).toBe('오늘은 설날, 일요일이에요')
    expect(KOREAN_DAYS['2026-09-25']).toBe('추석')
    expect(KOREAN_DAYS['2027-05-13']).toBe('부처님오신날')
    const h = buildHooks(data([]), photo('2026-10-12T10:00'), '기타', '맑고 선선한 날이에요')
    expect(text(h, 'weather')).toBe('맑고 선선한 날이에요')
    expect(ids(buildHooks(data([]), photo('2026-10-12T10:00'), '기타'))).not.toContain('weather')
  })

  it('keys a day on the given offset', () => {
    expect(localDayKey(at('2026-10-12T23:30'), KST)).toBe('2026-10-12')
    expect(localDayKey(at('2026-10-12T23:30'), 0)).toBe('2026-10-12')
    expect(localDayKey(at('2026-10-12T08:30'), 0)).toBe('2026-10-11')
  })
})

describe('loadContextData', () => {
  beforeEach(clearFirestore)
  const memo = (id: string, iso: string, extra: Record<string, unknown> = {}) => db.doc(`memos/${id}`).set({
    patientUid: 'p1', photoPath: `photos/p1/${id}.jpg`, takenAt: Timestamp.fromMillis(at(iso)), lat: 37.5, lng: 127.0,
    activity: '산책', memo: `${id} 제목`, status: 'ready', tags: { labels: [{ name: 'Tree', confidence: 0.9 }], text: [], faceCount: 0 }, ...extra,
  })

  it('loads the parent\'s earlier ready memos newest first, and their chosen style', async () => {
    await memo('a', '2026-10-10T10:00')
    await memo('b', '2026-10-11T10:00', { status: 'pending' })
    await memo('c', '2026-10-12T09:00')
    await memo('later', '2026-10-12T11:00')
    await db.doc('memos/other').set({ patientUid: 'p2', takenAt: Timestamp.fromMillis(at('2026-10-11T10:00')), status: 'ready', activity: '식사', memo: 'x' })
    await db.doc('users/p1').set({ patientName: '어머니', memoStyle: 'playful' })
    const d = await loadContextData('p1', new Date(at('2026-10-12T10:00')))
    expect(d.past.map((m) => m.id)).toEqual(['c', 'a'])
    expect(d.past[0]).toMatchObject({ activity: '산책', memo: 'c 제목', lat: 37.5, lng: 127.0, labels: ['tree'] })
    expect(d.style).toBe('playful')
  })

  it('defaults to the warm style', async () => {
    await db.doc('users/p1').set({ patientName: '어머니', memoStyle: 'loud' })
    expect((await loadContextData('p1', new Date())).style).toBe('warm')
  })
})
