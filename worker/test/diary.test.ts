// memoDiary: the scene as a short diary entry for the moment (llm/prompt.ts).
// Firestore is the real emulator; the model is a fake.

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { Timestamp } from 'firebase-admin/firestore'
import { processMemo, type MemoDeps } from '../src/handlers/memo'
import { buildPrompt, DIARY_MAX_CHARS, parseModelResponse, tidyScene, type PromptHints } from '../src/llm/prompt'
import { resetPlansCache } from '../src/plans'
import { dateHintAt, resetHomeCache, setTravelGeocoder } from '../src/travel'
import { db, clearFirestore } from './setup'

describe('diary prompt', () => {
  it('leaves the classic prompt exactly as it was without the flag', async () => {
    // The pre-diary prompt.ts, kept beside this test as a fixture.
    const old = await import('./fixtures/prompt.classic')
    for (const hints of [{}, { timeHint: '12:30', placeHint: '서초동, 서초구' }, { homeHint: { km: 900, away: true, homeArea: '서초동' }, textHint: ['OPEN'] }] as PromptHints[]) {
      expect(buildPrompt(hints)).toBe(old.buildPrompt(hints))
      expect(buildPrompt(hints, 'cloud')).toBe(old.buildPrompt(hints, 'cloud'))
    }
  })

  it('asks for a 3–5 sentence diary that opens with the date and area', () => {
    const p = buildPrompt({ diary: true, dateHint: '10월 18일 오후', placeHint: '강남' })
    expect(p).toContain('scene (그 순간의 짧은 일기, 3~5문장)')
    expect(p).toContain('- 날짜: 10월 18일 오후')
    expect(p).toContain('1인칭으로 쓰지 마세요')
    expect(p).toContain('냄새, 맛, 소리, 기분')
    expect(p).not.toContain('scene (설명, 짧은 문장 2~3개)')
    // The sign and Japanese rules stay.
    expect(p).toContain('배경의 글자:')
    expect(p).toContain('일본어나 한자로 된 글자는')
  })

  it('says the date is unknown rather than leaving the model to guess', () => {
    expect(buildPrompt({ diary: true })).toContain('- 날짜: 알 수 없음')
    expect(buildPrompt({})).not.toContain('- 날짜:')
  })

  it('gives every diary example its own date, none of them the one in the context', () => {
    const p = buildPrompt({ diary: true, dateHint: '1월 5일 저녁' })
    const examples = p.slice(p.indexOf('예시:'), p.indexOf('상황 정보 (참고용'))
    expect(examples).not.toContain('1월 5일')
    const dates = examples.match(/\d+월 \d+일 (아침|오후|저녁|밤)/g) ?? []
    expect(new Set(dates).size).toBeGreaterThanOrEqual(4)
  })
})

describe('diary text clean-up', () => {
  it('keeps five sentences for a diary, three otherwise', () => {
    const raw = '하나예요. 둘이에요. 셋이에요. 넷이에요. 다섯이에요. 여섯이에요.'
    expect(tidyScene(raw, false, true)).toBe('하나예요. 둘이에요. 셋이에요. 넷이에요. 다섯이에요.')
    expect(tidyScene(raw)).toBe('하나예요. 둘이에요. 셋이에요.')
  })

  it('drops whole sentences from the end past the length cap, never the first', () => {
    const long = `${'가'.repeat(120)}예요.`
    const out = tidyScene(`${long} ${long} ${long}`, false, true)
    expect(out.length).toBeLessThanOrEqual(DIARY_MAX_CHARS)
    expect(out).toBe(`${long} ${long}`)
    expect(tidyScene(`${'나'.repeat(300)}예요.`, false, true).length).toBeGreaterThan(DIARY_MAX_CHARS)
  })

  it('still drops sentences copying Japanese text', () => {
    expect(tidyScene('10월 18일 오후예요. 新宿駅 간판이 있어요. 역 앞이에요.', false, true)).toBe('10월 18일 오후예요. 역 앞이에요.')
  })

  it('parses a diary answer, accepting a short one', () => {
    const scene = '10월 18일 오후, 강남에서의 점심이에요. 돌솥 한 그릇이 놓여 있어요. 반찬도 차려져 있어요. 든든한 한 끼예요.'
    expect(parseModelResponse(JSON.stringify({ activity: '식사', memo: '돌솥밥으로 점심', scene }), { diary: true })?.scene).toBe(scene)
    expect(parseModelResponse('{"activity":"기타","memo":"흐릿한 사진","scene":"사진이 흐려요."}', { diary: true })?.scene).toBe('사진이 흐려요.')
  })
})

describe('date hint', () => {
  const at = (iso: string) => dateHintAt(new Date(iso))
  it('names the day and part of day on the given local clock', () => {
    expect(at('2026-10-18T12:46:00Z')).toBe('10월 18일 오후')
    expect(at('2026-04-02T05:00:00Z')).toBe('4월 2일 아침')
    expect(at('2026-04-02T10:59:00Z')).toBe('4월 2일 아침')
    expect(at('2026-04-02T11:00:00Z')).toBe('4월 2일 오후')
    expect(at('2026-04-02T18:00:00Z')).toBe('4월 2일 저녁')
    expect(at('2026-04-02T22:00:00Z')).toBe('4월 2일 밤')
    expect(at('2026-04-02T04:59:00Z')).toBe('4월 2일 밤')
  })
})

describe('memoDiary flag in the pipeline', () => {
  type Hints = PromptHints & { temperature?: number }
  let last: Hints | null = null
  const deps: MemoDeps = {
    loadPhoto: async () => ({ photoUrl: 'https://example.test/p.jpg', base64: async () => 'aGk=' }),
    geocode: async () => ({ place: '역삼동, 강남구', address: '서울특별시 강남구' }),
    generate: async (args: Hints) => {
      last = args
      return { activity: '식사', memo: '점심', scene: '점심이에요.', model: 'gemma4:e4b', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 } }
    },
  }
  const seed = () => db.doc('memos/m1').set({
    patientUid: 'p1', photoPath: 'photos/p1/m1.jpg', photoUrl: '',
    // 12:46 in Korea (the phone's own offset).
    takenAt: Timestamp.fromDate(new Date('2026-10-18T03:46:00Z')), tzOffsetMin: 540,
    lat: 37.5, lng: 127.03, place: '', activity: '기타', memo: '', scene: '', status: 'pending', createdAt: Timestamp.now(),
  })

  beforeEach(async () => {
    await clearFirestore(); resetPlansCache(); resetHomeCache(); last = null
    setTravelGeocoder(async () => ({ place: '', address: '' }))
  })

  it('asks for a diary with the local date when the flag is on', async () => {
    await db.doc('admin_config/plans').set({ flags: { memoDiary: true } })
    await seed()
    expect(await processMemo('m1', 1, deps)).toBe('done')
    expect(last).toMatchObject({ diary: true, dateHint: '10월 18일 오후' })
  })

  it('asks for the classic description when the flag is off', async () => {
    await db.doc('admin_config/plans').set({ flags: { memoDiary: false } })
    await seed()
    expect(await processMemo('m1', 1, deps)).toBe('done')
    expect(last?.diary).toBeUndefined()
    expect(last?.dateHint).toBeUndefined()
  })
})

// Guard against the fixture drifting from what shipped before the diary.
describe('classic prompt fixture', () => {
  it('is the pre-diary prompt.ts', () => {
    const fixture = readFileSync(new URL('./fixtures/prompt.classic.ts', import.meta.url), 'utf8')
    expect(fixture).toContain("'scene (설명, 짧은 문장 2~3개):'")
    expect(fixture).not.toContain('DIARY_SCENE_LINES')
  })
})
