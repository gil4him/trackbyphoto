import { describe, it, expect } from 'vitest'
import { lightPhase, momentLines, partOfDay, sunTimes, minutesOf } from '../src/llm/moment'
import { buildPrompt } from '../src/llm/prompt'
import { buildSeePrompt, buildWritePrompt } from '../src/llm/promptV2'

describe('the moment a photo was taken', () => {
  it('names the part of the day', () => {
    expect(partOfDay(minutesOf('07:42')!)).toBe('아침')
    expect(partOfDay(minutesOf('12:10')!)).toBe('점심때')
    expect(partOfDay(minutesOf('18:20')!)).toBe('저녁 무렵')
    expect(partOfDay(minutesOf('23:30')!)).toBe('밤')
  })

  it('works out sunrise and sunset within minutes', () => {
    // Seoul, 2026-10-19 (KASI: 06:41 / 17:51)
    const seoul = sunTimes({ year: 2026, month: 10, day: 19 }, 37.5665, 126.978, 540)!
    expect(Math.abs(minutesOf(seoul.rise)! - minutesOf('06:41')!)).toBeLessThanOrEqual(5)
    expect(Math.abs(minutesOf(seoul.set)! - minutesOf('17:51')!)).toBeLessThanOrEqual(5)
    // Panama City, 2026-10-19 (≈06:07 / 18:00)
    const pty = sunTimes({ year: 2026, month: 10, day: 19 }, 8.98, -79.52, -300)!
    expect(Math.abs(minutesOf(pty.rise)! - minutesOf('06:07')!)).toBeLessThanOrEqual(6)
    expect(Math.abs(minutesOf(pty.set)! - minutesOf('18:00')!)).toBeLessThanOrEqual(6)
  })

  it('tells a morning from a sunset', () => {
    const sun = { rise: '06:41', set: '17:51' }
    expect(lightPhase(minutesOf('07:30')!, sun)).toContain('아침')
    expect(lightPhase(minutesOf('07:30')!, sun)).not.toContain('노을')
    expect(lightPhase(minutesOf('17:40')!, sun)).toContain('노을')
    expect(lightPhase(minutesOf('21:00')!, sun)).toContain('밤')
  })

  it('spells the moment out for the model', () => {
    const lines = momentLines({ timeHint: '07:42', dayHint: '월요일', sunHint: { rise: '06:41', set: '17:51' }, todayHint: ['06:50 · 산책 · 집 앞 공원을 걸으셨어요 · 서초동'] }).join('\n')
    expect(lines).toContain('- 찍은 때: 월요일 아침 07:42')
    expect(lines).toContain('해 지는 시각 17:51')
    expect(lines).toContain('06:50 · 산책 · 집 앞 공원을 걸으셨어요')
    expect(momentLines({ timeHint: '07:42', todayHint: ['x'] }, { guess: false }).join('\n')).not.toContain('x')
  })

  it('asks every prompt for what the parent was doing, at the right time of day', () => {
    const hints = { timeHint: '07:42', dayHint: '월요일', sunHint: { rise: '06:41', set: '17:51' } }
    for (const p of [buildPrompt(hints), buildPrompt(hints, 'cloud')]) {
      expect(p).toContain('무엇을 하고 계셨는지')
      expect(p).toContain('- 찍은 때: 월요일 아침 07:42')
      expect(p).toContain('"guess"')
      expect(p).not.toContain('- 시간:')
    }
    expect(buildSeePrompt(hints)).toContain('- 찍은 때: 월요일 아침 07:42')
    const w = buildWritePrompt({ seen: { activity: '산책', subjects: ['나무'], setting: '공원길', description: '', signText: [], peopleCount: 0 }, hooks: [], recentTitles: [], style: 'warm', hints })
    expect(w).toContain('- 찍은 때: 월요일 아침 07:42')
    expect(w).toContain('"guess"')
  })
})

describe('the nearest place on the map', () => {
  it('gives the local model the shop name as a GPS clue, without its menu', () => {
    const p = buildPrompt({ timeHint: '13:34', placeHint: 'Buena Park, 미국', placeFull: 'Han Yang Restaurant · Buena Park, 미국' })
    expect(p).toContain('- 지도에서 가장 가까운 곳: Han Yang Restaurant · Buena Park, 미국')
    expect(p).toContain('수십 m 오차')
    expect(p).toContain('메뉴·상품·음식은 사진에 보이지 않으면 지어내지 마세요')
    expect(p).toContain('관계(가족·딸·친구 등)')
  })

  it('leaves it out when the place was borrowed, or is in Japanese for the local model', () => {
    expect(buildPrompt({ placeFull: 'Han Yang Restaurant · Buena Park, 미국', nearHint: true })).not.toContain('지도에서 가장 가까운 곳')
    expect(buildPrompt({ placeFull: 'くら寿司 · 니시신주쿠' })).not.toContain('くら寿司')
    expect(buildPrompt({ placeFull: 'くら寿司 · 니시신주쿠' }, 'cloud')).toContain('くら寿司')
  })

  it('gives it to the v2 writer too', () => {
    const w = buildWritePrompt({ seen: { activity: '모임', subjects: ['건물'], setting: '상가 앞', description: '', signText: [], peopleCount: 3 }, hooks: [], recentTitles: [], style: 'warm', hints: { timeHint: '13:34', placeFull: 'Han Yang Restaurant · Buena Park, 미국' } })
    expect(w).toContain('Han Yang Restaurant')
    expect(w).toContain('"일행과 함께"')
  })
})

describe('background without meaning', () => {
  it('tells every writer to leave it out', () => {
    expect(buildPrompt({})).toContain('물건·배경을 나열하는 문장은 금지예요')
    expect(buildPrompt({}, 'cloud')).toContain('그날을 기억하게 하는 한 줄 일기')
    expect(buildWritePrompt({ seen: { activity: '모임', subjects: [], setting: '상가 앞', description: '', signText: [], peopleCount: 2 }, hooks: [], recentTitles: [], style: 'plain' })).toContain('물건을 나열하거나 묘사하는 문장 금지')
    expect(buildSeePrompt({})).toContain('뜻 없는 배경은 넣지 마세요')
  })
})

describe('background sentences in code', () => {
  it('drops them from the description, keeping the first sentence and signs', async () => {
    const { tidyScene } = await import('../src/llm/prompt')
    expect(tidyScene('일요일 오후, 건물 앞에서 사진을 찍으셨어요. 뒤로 상업 시설들이 보입니다.')).toBe('일요일 오후, 건물 앞에서 사진을 찍으셨어요.')
    expect(tidyScene('일요일 점심, 식당 안에서 식사하셨어요. 식탁 위에 냄비가 놓여 있어요. 뒤쪽 벽에 한글과 영어로 된 광고가 보여요.')).toBe('일요일 점심, 식당 안에서 식사하셨어요.')
    expect(tidyScene('가족사진을 찍으셨어요. 흰색 차량이 주차되어 있어요.')).toBe('가족사진을 찍으셨어요.')
    expect(tidyScene('식당에 가셨어요. 뒤로 "한양식당" 간판이 보여요.')).toBe('식당에 가셨어요.')
    expect(tidyScene('일행과 점심을 드셨어요. 식탁 위에 물잔과 휴지가 놓여 있어요.')).toBe('일행과 점심을 드셨어요.')
    expect(tidyScene('공항에 도착하셨어요. 편의점에서 간식을 고르셨어요.')).toBe('공항에 도착하셨어요. 편의점에서 간식을 고르셨어요.')
  })
})

describe('shop names', () => {
  it('asks Gemini for one Korean spelling of a foreign shop name', () => {
    expect(buildPrompt({}, 'cloud')).toContain('"Han Yang Restaurant" → "한양식당"')
    expect(buildPrompt({})).not.toContain('"Han Yang Restaurant" → "한양식당"')
  })
})
