// "When" for the memo prompts: the part of the day, the day of the week,
// sunrise and sunset at that spot, and what the parent photographed earlier
// today. A bare "07:42" is not enough: a model looking at warm light wrote
// "노을" for a morning photo. Spelling the moment out ("월요일 아침 07:42, 해가
// 뜬 지 약 1시간") lets it guess what the parent was doing then, and stops it
// calling a sunrise a sunset. Pure; no Firestore.

import type { PromptHints } from './prompt.js'
import { weatherText } from '../weather.js'

/** "07:42" → minutes since midnight; null when it isn't HH:MM. */
export function minutesOf(hhmm: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** The Korean word a family would use for that time of day. */
export function partOfDay(min: number): string {
  if (min < 4 * 60) return '한밤중'
  if (min < 6 * 60) return '새벽'
  if (min < 9 * 60) return '아침'
  if (min < 11 * 60 + 30) return '오전'
  if (min < 13 * 60 + 30) return '점심때'
  if (min < 17 * 60) return '오후'
  if (min < 19 * 60) return '저녁 무렵'
  if (min < 22 * 60) return '저녁'
  return '밤'
}

/**
 * Sunrise and sunset (HH:MM on the photographer's clock) at a spot on a
 * local calendar day: the NOAA approximation, within a few minutes, which is
 * all "is this a sunrise or a sunset" needs. Null in polar day or night.
 */
export function sunTimes(localDate: { year: number; month: number; day: number }, lat: number, lng: number, offsetMin: number): { rise: string; set: string } | null {
  const rad = Math.PI / 180
  const start = Date.UTC(localDate.year, 0, 1)
  const n = Math.floor((Date.UTC(localDate.year, localDate.month - 1, localDate.day) - start) / 86_400_000) + 1
  const g = ((2 * Math.PI) / 365) * (n - 1)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)
  if (cosHa < -1 || cosHa > 1) return null
  const ha = Math.acos(cosHa) / rad
  const riseUtc = 720 - 4 * (lng + ha) - eqTime
  const setUtc = 720 - 4 * (lng - ha) - eqTime
  return { rise: hhmm(riseUtc + offsetMin), set: hhmm(setUtc + offsetMin) }
}

/** Where the sun is at that minute, in words; '' when the sun times are unknown. */
export function lightPhase(min: number, sun: { rise: string; set: string } | undefined): string {
  const rise = minutesOf(sun?.rise)
  const set = minutesOf(sun?.set)
  if (rise == null || set == null) return ''
  const ago = (m: number) => (m < 50 ? '얼마 안 된' : `약 ${Math.round(m / 60)}시간 지난`)
  if (min < rise - 40) return '해가 뜨기 전이라 아직 어두운 때'
  if (min < rise + 20) return '해가 막 뜨는 때 (일출)'
  if (min < rise + 180) return `해가 뜬 지 ${ago(min - rise)} 아침`
  if (min < set - 70) return '해가 높이 뜬 낮'
  if (min < set + 25) return '해가 지는 때 (노을이 질 수 있는 시간)'
  if (min < set + 60) return '해가 막 진 뒤라 어둑한 때'
  return '해가 진 뒤의 밤'
}

/** The 찍은 때 block of the 상황 정보: when, the light, and earlier photos today.
 *  `guess: false` (memo v2's see(), which only records facts) leaves out the
 *  "guess what they were doing" line and the earlier photos. */
export function momentLines({ timeHint, dayHint, sunHint, todayHint, weather }: PromptHints, opts: { guess?: boolean } = {}): string[] {
  const guess = opts.guess !== false
  const min = minutesOf(timeHint)
  const lines: string[] = []
  if (min == null) {
    lines.push(
      '- 찍은 때: 알 수 없음',
      '  → 아침·저녁·노을·밤 같은 시간대를 사진의 빛만 보고 단정하지 마세요.',
    )
  } else {
    const when = [dayHint, partOfDay(min), timeHint].filter(Boolean).join(' ')
    lines.push(`- 찍은 때: ${when}`)
    const phase = lightPhase(min, sunHint)
    if (sunHint && phase) lines.push(`  → 그날 해 뜨는 시각 ${sunHint.rise}, 해 지는 시각 ${sunHint.set}. 찍은 시점: ${phase}.`)
    lines.push(
      '  → 이 시간이 사실이에요. 사진의 빛이 붉거나 노래 보여도 시간대는 여기에 맞추세요.',
      '  → "노을·석양·해 질 녘"은 해 지는 시각 앞뒤에만, "밤·야경"은 해가 진 뒤에만, "일출·해돋이"는 해 뜨는 시각 앞뒤에만 써요. 아침의 붉고 노란 빛은 "아침 햇살"이에요.',
      ...(guess ? ['  → 시간으로 무엇을 하던 때인지 짐작하세요 (이른 아침 → 아침 산책·출근길, 점심때 → 점심 식사, 저녁 → 퇴근길·저녁 식사, 밤 → 귀가·휴식).'] : []),
    )
  }
  lines.push(weather
    ? `- 날씨 (그 시각 실제 기록): ${weatherText(weather)}`
    : '- 날씨: 알 수 없음 → 날씨는 쓰지 마세요.')
  if (guess && todayHint?.length) {
    lines.push(
      '- 오늘 앞서 찍은 사진 (오래된 순, 시각 · 분류 · 기록 · 지역):',
      ...todayHint.map((t) => `  - ${t}`),
      '  → 지금 사진과 이어지는 흐름이면 활용하세요 (공항 도착 → 탑승 대기, 시장 → 장 본 뒤 귀가, 식당 → 식사 뒤 산책). 같은 말을 되풀이하지는 마세요.',
    )
  }
  return lines
}
