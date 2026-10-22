// The memo tone (llm/prompt.ts). The default is the memory diary, the CEO's
// decision (CLAUDE.md): title = what the parent did + where, scene = one line
// with real memory anchors, never a description of the photo. memoDiary (a
// description-first diary) stays in the code for scripts/memo-diary-compare
// only; the pipeline never asks for it.
// Firestore is the real emulator; the model is a fake.

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { Timestamp } from 'firebase-admin/firestore'
import { processMemo, type MemoDeps } from '../src/handlers/memo'
import { buildPrompt, DIARY_MAX_CHARS, diaryOpener, diaryScene, parseModelResponse, tidyScene, type PromptHints } from '../src/llm/prompt'
import { resetPlansCache } from '../src/plans'
import { dateHintAt, resetHomeCache, setTravelGeocoder } from '../src/travel'
import { db, clearFirestore } from './setup'

describe('diary prompt', () => {
  it('is the memory diary by default, no longer the classic photo description', async () => {
    // The pre-diary prompt.ts, kept beside this test as a fixture.
    const old = await import('./fixtures/prompt.classic')
    for (const hints of [{}, { timeHint: '12:30', placeHint: '서초동, 서초구' }] as PromptHints[]) {
      for (const variant of ['local', 'cloud'] as const) {
        const p = buildPrompt(hints, variant)
        expect(p).not.toBe(old.buildPrompt(hints, variant))
        expect(p).toContain("memo (제목 한 줄, 12~24자) — 하신 일 + 장소:")
        expect(p).toContain('scene (그날을 기억하게 하는 한 줄 일기, 1문장 · 많아야 2문장 · 50자 이내):')
        expect(p).toContain('맑고 따뜻한 일요일, 점심을 드시고 나와 일행과 기념사진을 남기셨어요.')
        expect(p).not.toContain('scene (설명, 짧은 문장 2~3개)')
        expect(p).not.toContain('scene (그 순간의 짧은 일기, 3~4문장)')
      }
    }
  })

  it('puts a landmark first in the title and ends it with "!", and only then', () => {
    const p = buildPrompt({})
    expect(p).toContain('그 이름을 맨 앞에 두고 반갑게 "!"로 끝내세요: "불국사에 다녀오셨어요!"')
    expect(p).toContain('명소가 아니면 "!"를 쓰지 마세요.')
    expect(p).toContain('"memo":"불국사에 다녀오셨어요!"')
  })

  it('gives the real weather when there is one, and forbids guessing it otherwise', () => {
    const withWeather = buildPrompt({ timeHint: '12:20', weather: { code: 'Rain', label: '비', tempC: 9, feel: '쌀쌀한 날' } })
    expect(withWeather).toContain('- 날씨 (그 시각 실제 기록): ')
    expect(withWeather).toMatch(/- 날씨 \(그 시각 실제 기록\): [^\n]*비/)
    const without = buildPrompt({ timeHint: '12:20' })
    expect(without).toContain('- 날씨: 알 수 없음 → 날씨는 쓰지 마세요.')
    expect(without).toContain('사진의 빛이나 하늘을 보고 날씨를 짐작하지 마세요')
  })

  it('drops sentences that list what is lying around, never the first one; a memoDiary body keeps them', () => {
    const raw = '맑은 화요일, 집에서 점심을 드셨어요. 식탁 위에 물잔이 놓여 있어요. 뒤로 상점들이 보여요.'
    expect(tidyScene(raw)).toBe('맑은 화요일, 집에서 점심을 드셨어요.')
    expect(tidyScene('식탁 위에 물잔이 놓여 있어요.')).toBe('식탁 위에 물잔이 놓여 있어요.')
    expect(tidyScene(raw, false, true)).toBe(raw)
  })

  it('asks for a 3–4 sentence diary body that starts with what is visible', () => {
    const p = buildPrompt({ diary: true, dateHint: '10월 18일 오후', placeHint: '강남' })
    expect(p).toContain('scene (그 순간의 짧은 일기, 3~4문장)')
    expect(p).toContain('날짜와 지역은 앱이 맨 앞에 붙여요')
    expect(p).toContain('1인칭으로 쓰지 마세요')
    expect(p).toContain('냄새, 맛, 소리, 기분')
    expect(p).not.toContain('scene (설명, 짧은 문장 2~3개)')
    // The sign and Japanese rules stay.
    expect(p).toContain('배경의 글자:')
    expect(p).toContain('일본어나 한자로 된 글자는')
  })

  it('never shows the model a date to copy: the opener is added in code', () => {
    const p = buildPrompt({ diary: true, dateHint: '1월 5일 저녁' })
    expect(p).not.toContain('1월 5일')
    const examples = p.slice(p.indexOf('예시:'), p.indexOf('상황 정보 (참고용'))
    expect(examples).not.toMatch(/\d+월 \d+일 (아침|오후|저녁|밤)/)
  })
})

describe('diary opener', () => {
  it('is the date and the first part of the area', () => {
    expect(diaryOpener('10월 18일 오후', '잠실동, 송파구')).toBe('10월 18일 오후, 잠실동에서.')
    expect(diaryOpener('10월 18일 오후', 'Buena Park, 미국')).toBe('10월 18일 오후, Buena Park에서.')
    expect(diaryOpener('10월 18일 오후')).toBe('10월 18일 오후.')
    expect(diaryOpener(undefined, '강남')).toBe('강남에서.')
    expect(diaryOpener()).toBe('')
  })

  it('goes in front of what the model wrote', () => {
    expect(diaryScene('돌솥 한 그릇이 놓여 있어요.', { dateHint: '10월 18일 오후', placeHint: '강남' })).toBe('10월 18일 오후, 강남에서. 돌솥 한 그릇이 놓여 있어요.')
    expect(diaryScene('돌솥이 있어요.', {})).toBe('돌솥이 있어요.')
  })
})

describe('diary text clean-up', () => {
  it('keeps four sentences for a diary body, three otherwise', () => {
    const raw = '하나예요. 둘이에요. 셋이에요. 넷이에요. 다섯이에요.'
    expect(tidyScene(raw, false, true)).toBe('하나예요. 둘이에요. 셋이에요. 넷이에요.')
    expect(tidyScene(raw)).toBe('하나예요. 둘이에요. 셋이에요.')
  })

  it('drops whole sentences from the end past the length cap, never the first', () => {
    const long = `${'가'.repeat(100)}예요.`
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

describe('the pipeline never asks for memoDiary', () => {
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

  it('writes the memory diary even with the memoDiary flag on (the flag is superseded)', async () => {
    await db.doc('admin_config/plans').set({ flags: { memoDiary: true } })
    await seed()
    expect(await processMemo('m1', 1, deps)).toBe('done')
    expect(last?.diary).toBeUndefined()
    expect(last?.dateHint).toBeUndefined()
    // The memory anchors are there instead.
    expect(last?.dayHint).toBeTruthy()
  })

  it('and with it off', async () => {
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
