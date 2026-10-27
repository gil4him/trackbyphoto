// The parent's language on the way from Firestore to the prompt:
// users/{patientUid}.geoLang → resolveGeoLang → memoArgsFor's `lang` → the
// prompt (buildPrompt / buildPromptEn) and the post-processing.
// Firestore is the real emulator; the model is a fake.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { processMemo, type MemoDeps } from '../src/handlers/memo'
import { buildPrompt, type PromptHints } from '../src/llm/prompt'
import { resetPlansCache } from '../src/plans'
import { resetHomeCache, setTravelGeocoder } from '../src/travel'
import { db, clearFirestore } from './setup'

type Hints = PromptHints & { temperature?: number }

describe('the memo language', () => {
  let last: Hints | null = null
  const deps: MemoDeps = {
    loadPhoto: async () => ({ photoUrl: 'https://example.test/p.jpg', base64: async () => 'aGk=' }),
    geocode: async () => ({ place: 'Gangnam · Yeoksam-dong, Seoul', address: 'Seoul' }),
    generate: async (args: Hints) => {
      last = args
      return { activity: '식사', memo: 'Lunch at home', scene: 'A clear Sunday, lunch at home.', model: 'gemma4:e4b', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 } }
    },
  }

  /** `takenAt` is UTC; tzOffsetMin 540 makes it the parent's Korean clock. */
  const seed = (takenAt = '2026-10-18T03:46:00Z') => db.doc('memos/m1').set({
    patientUid: 'p1', photoPath: 'photos/p1/m1.jpg', photoUrl: '',
    takenAt: Timestamp.fromDate(new Date(takenAt)), tzOffsetMin: 540,
    lat: 37.5, lng: 127.03, place: '', activity: '기타', memo: '', scene: '', status: 'pending', createdAt: Timestamp.now(),
  })

  beforeEach(async () => {
    await clearFirestore(); resetPlansCache(); resetHomeCache(); last = null
    setTravelGeocoder(async () => ({ place: '', address: '' }))
  })

  it("is the parent's geoLang, and 'en' writes the English prompt", async () => {
    await db.doc('users/p1').set({ geoLang: 'en' })
    await seed()
    expect(await processMemo('m1', 1, deps)).toBe('done')
    expect(last?.lang).toBe('en')
    // 2026-10-18 12:46 on the parent's clock is a Sunday.
    expect(last?.dayHint).toBe('Sunday')
    const prompt = buildPrompt(last!)
    expect(prompt).toContain('Common rules:')
    expect(prompt).toContain('- Time taken: Sunday lunchtime 12:46')
    expect(prompt).not.toContain('공통 규칙')
    // The memo the fake wrote is stored as it is.
    expect((await db.doc('memos/m1').get()).data()?.memo).toBe('Lunch at home')
  })

  it('is Korean when nothing says otherwise, and the prompt is unchanged', async () => {
    await seed()
    expect(await processMemo('m1', 1, deps)).toBe('done')
    expect(last?.lang).toBe('ko')
    expect(last?.dayHint).toBe('일요일')
    const prompt = buildPrompt(last!)
    expect(prompt).toContain('공통 규칙:')
    expect(prompt).not.toContain('Common rules:')
  })

  it('names a Korean holiday in English, and leaves the solar terms out', async () => {
    await db.doc('users/p1').set({ geoLang: 'en' })
    // 2026-10-09 12:00 on the parent's clock: 한글날, a Friday.
    await seed('2026-10-09T03:00:00Z')
    expect(await processMemo('m1', 1, deps)).toBe('done')
    expect(last?.dayHint).toBe('Friday, Hangul Day')

    await clearFirestore(); resetHomeCache(); resetPlansCache()
    await db.doc('users/p1').set({ geoLang: 'en' })
    // 2026-10-23 is 상강, a solar term: the English hint is the weekday alone.
    await seed('2026-10-23T03:00:00Z')
    expect(await processMemo('m1', 1, deps)).toBe('done')
    expect(last?.dayHint).toBe('Friday')
  })
})
