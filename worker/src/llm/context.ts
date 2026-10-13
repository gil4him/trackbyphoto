// The context pack for memo v2: what the worker knows about this photo
// beyond the picture — how many today, what came before, a streak, a place
// seen before, a seasonal first, the calendar — turned into short "hooks"
// the writer may use (at most one). The loader does one bounded Firestore
// query; everything else is pure, so it can be tested on plain data.

import { getFirestore } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { flagOn } from '../plans.js'
import { distanceKm, localOffsetMin } from '../travel.js'

export type MemoStyle = 'plain' | 'warm' | 'playful'
export const MEMO_STYLES: MemoStyle[] = ['plain', 'warm', 'playful']
export const DEFAULT_STYLE: MemoStyle = 'warm'

export type HookId = 'nth' | 'today' | 'streak' | 'revisit' | 'first' | 'calendar' | 'weather'
export interface Hook {
  id: HookId
  text: string
}

/** An earlier memo of the same parent, as the hooks need it. */
export interface PastMemo {
  id: string
  takenAtMs: number
  activity: string
  memo: string
  lat: number | null
  lng: number | null
  /** Vision labels the phone attached (English), lower-cased. */
  labels: string[]
  memoSource?: string
}

/** The photo the memo is for. */
export interface PhotoCtx {
  takenAtMs: number
  lat: number | null
  lng: number | null
  /** The photographer's UTC offset in minutes. */
  tzOffsetMin: number
  labels: string[]
}

export interface ContextData {
  /** Earlier memos, newest first, at most PAST_LIMIT. */
  past: PastMemo[]
  style: MemoStyle
}

export const PAST_LIMIT = 30
export const RECENT_TITLES = 10
export const REVISIT_KM = 0.2
const STUB_TITLES = new Set(['사진을 기록했어요.', '사진을 남겼어요'])
const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']
const FIRST_AFTER_DAYS = 30

/** YYYY-MM-DD on the photographer's clock. */
export function localDayKey(ms: number, tzOffsetMin: number): string {
  return new Date(ms + tzOffsetMin * 60_000).toISOString().slice(0, 10)
}
function localDate(ms: number, tzOffsetMin: number): Date {
  return new Date(ms + tzOffsetMin * 60_000)
}
const dayLabel = (d: Date) => `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`

/**
 * Korean public holidays (대체공휴일 included), 어버이날, and the 24 절기 for
 * 2026–2027, from the Korea Astronomy and Space Science Institute's calendar
 * (astro.kasi.re.kr, 2026-10-13). Lunar dates are looked up, never computed.
 */
export const KOREAN_DAYS: Record<string, string> = {
  '2026-01-01': '신정', '2026-01-05': '소한', '2026-01-20': '대한', '2026-02-04': '입춘', '2026-02-16': '설날 연휴', '2026-02-17': '설날',
  '2026-02-18': '설날 연휴', '2026-02-19': '우수', '2026-03-01': '삼일절', '2026-03-02': '삼일절 대체공휴일', '2026-03-05': '경칩', '2026-03-20': '춘분',
  '2026-04-05': '청명', '2026-04-20': '곡우', '2026-05-05': '어린이날', '2026-05-08': '어버이날', '2026-05-21': '소만', '2026-05-24': '부처님오신날',
  '2026-05-25': '부처님오신날 대체공휴일', '2026-06-06': '현충일', '2026-06-21': '하지', '2026-07-07': '소서', '2026-07-23': '대서', '2026-08-07': '입추',
  '2026-08-15': '광복절', '2026-08-17': '광복절 대체공휴일', '2026-08-23': '처서', '2026-09-07': '백로', '2026-09-23': '추분', '2026-09-24': '추석 연휴',
  '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-03': '개천절', '2026-10-05': '개천절 대체공휴일', '2026-10-08': '한로', '2026-10-09': '한글날',
  '2026-10-23': '상강', '2026-11-07': '입동', '2026-11-22': '소설', '2026-12-07': '대설', '2026-12-22': '동지', '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-01-05': '소한', '2027-01-20': '대한', '2027-02-04': '입춘', '2027-02-06': '설날 연휴', '2027-02-07': '설날',
  '2027-02-08': '설날 연휴', '2027-02-09': '설날 대체공휴일', '2027-02-19': '우수', '2027-03-01': '삼일절', '2027-03-06': '경칩', '2027-03-21': '춘분',
  '2027-04-05': '청명', '2027-04-20': '곡우', '2027-05-01': '노동절', '2027-05-03': '노동절 대체공휴일', '2027-05-05': '어린이날', '2027-05-06': '입하',
  '2027-05-08': '어버이날', '2027-05-13': '부처님오신날', '2027-05-21': '소만', '2027-06-06': '현충일', '2027-06-21': '하지', '2027-07-07': '소서',
  '2027-07-17': '제헌절', '2027-07-19': '제헌절 대체공휴일', '2027-07-23': '대서', '2027-08-08': '입추', '2027-08-15': '광복절', '2027-08-16': '광복절 대체공휴일',
  '2027-08-23': '처서', '2027-09-08': '백로', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴', '2027-09-23': '추분',
  '2027-10-03': '개천절', '2027-10-04': '개천절 대체공휴일', '2027-10-08': '한로', '2027-10-09': '한글날', '2027-10-11': '한글날 대체공휴일', '2027-10-24': '상강',
  '2027-11-08': '입동', '2027-11-22': '소설', '2027-12-07': '대설', '2027-12-22': '동지', '2027-12-25': '성탄절', '2027-12-27': '성탄절 대체공휴일',
}
// 2026-05-05 is both 어린이날 and 입하; the holiday is what the family would say.

/** Seasonal things worth a "first": the phone's Vision label → the Korean word. */
const SEASONAL: [RegExp, string][] = [
  [/cherry|blossom/, '벚꽃'], [/\bsnow/, '눈'], [/\bsea\b|ocean|beach|coast/, '바다'], [/autumn|maple|foliage/, '단풍'],
  [/rainbow/, '무지개'], [/firework/, '불꽃놀이'], [/hydrangea/, '수국'], [/sunflower/, '해바라기'], [/cosmos/, '코스모스'], [/ginkgo/, '은행잎'],
]
function seasonalWord(labels: string[]): string | null {
  const text = labels.join(' ')
  for (const [re, word] of SEASONAL) if (re.test(text)) return word
  return null
}

/** The last titles the writer must not echo (stubs left out). */
export function recentTitles(past: PastMemo[]): string[] {
  return past.map((m) => m.memo).filter((t) => t && !STUB_TITLES.has(t)).slice(0, RECENT_TITLES)
}

/** The hooks for this photo, given the facts the model saw (its activity). */
export function buildHooks(data: ContextData, photo: PhotoCtx, activity: string, weather: string | null = null): Hook[] {
  const hooks: Hook[] = []
  const tz = photo.tzOffsetMin
  const today = localDayKey(photo.takenAtMs, tz)
  const earlier = data.past.filter((m) => m.takenAtMs < photo.takenAtMs)
  const todays = earlier.filter((m) => localDayKey(m.takenAtMs, tz) === today)

  if (todays.length >= 1) hooks.push({ id: 'nth', text: `오늘 ${todays.length + 1}번째 사진이에요` })
  const titles = [...todays].reverse().map((m) => m.memo).filter((t) => t && !STUB_TITLES.has(t)).slice(-3)
  if (titles.length) hooks.push({ id: 'today', text: `오늘 앞서 남긴 기록: ${titles.map((t) => `"${t}"`).join(', ')}` })

  // A streak: this activity on each of the days right before today, and today.
  if (activity && activity !== '기타') {
    const days = new Set(earlier.filter((m) => m.activity === activity).map((m) => localDayKey(m.takenAtMs, tz)))
    let n = 1
    for (let back = 1; back <= PAST_LIMIT; back++) {
      if (!days.has(localDayKey(photo.takenAtMs - back * 86_400_000, tz))) break
      n++
    }
    if (n >= 2) hooks.push({ id: 'streak', text: `${n}일째 이어지는 ${activity}이에요` })
  }

  if (photo.lat != null && photo.lng != null) {
    const here = { lat: photo.lat, lng: photo.lng }
    let best: { m: PastMemo; km: number } | null = null
    for (const m of earlier) {
      if (m.lat == null || m.lng == null || localDayKey(m.takenAtMs, tz) === today) continue
      const km = distanceKm(here, { lat: m.lat, lng: m.lng })
      if (km <= REVISIT_KM && (!best || km < best.km)) best = { m, km }
    }
    if (best) {
      const when = dayLabel(localDate(best.m.takenAtMs, tz))
      const title = best.m.memo && !STUB_TITLES.has(best.m.memo) ? `: "${best.m.memo}"` : ''
      hooks.push({ id: 'revisit', text: `${when}에도 이 근처에 오셨어요${title}` })
    }
  }

  // A seasonal first: the thing is in this photo's labels and in none of the
  // earlier ones. Only claimed when the window reaches far enough back.
  const word = seasonalWord(photo.labels)
  if (word && earlier.length > 0 && !earlier.some((m) => seasonalWord(m.labels) === word)) {
    const oldest = earlier[earlier.length - 1].takenAtMs
    const year = localDate(photo.takenAtMs, tz).getUTCFullYear()
    if (localDate(oldest, tz).getUTCFullYear() < year) hooks.push({ id: 'first', text: `올해 처음 보는 ${word}이에요` })
    else if (photo.takenAtMs - oldest >= FIRST_AFTER_DAYS * 86_400_000) hooks.push({ id: 'first', text: `오랜만에 보는 ${word}이에요` })
  }

  const d = localDate(photo.takenAtMs, tz)
  const special = KOREAN_DAYS[today]
  hooks.push({ id: 'calendar', text: special ? `오늘은 ${special}, ${WEEKDAYS[d.getUTCDay()]}이에요` : `오늘은 ${WEEKDAYS[d.getUTCDay()]}이에요` })

  if (weather) hooks.push({ id: 'weather', text: weather })
  return hooks
}

/** Earlier memos and the family's chosen style, from Firestore. */
export async function loadContextData(patientUid: string, takenAt: Date): Promise<ContextData> {
  const db = getFirestore()
  const [snap, user] = await Promise.all([
    db.collection('memos')
      .where('patientUid', '==', patientUid)
      .where('takenAt', '<', takenAt)
      .orderBy('takenAt', 'desc')
      .limit(PAST_LIMIT)
      .get(),
    db.collection('users').doc(patientUid).get(),
  ])
  const past: PastMemo[] = snap.docs
    .filter((d) => d.get('status') === 'ready')
    .map((d) => ({
      id: d.id,
      takenAtMs: (d.get('takenAt') as FirebaseFirestore.Timestamp).toMillis(),
      activity: (d.get('activity') as string) || '기타',
      memo: (d.get('memo') as string) || '',
      lat: typeof d.get('lat') === 'number' ? (d.get('lat') as number) : null,
      lng: typeof d.get('lng') === 'number' ? (d.get('lng') as number) : null,
      labels: labelsOf(d.get('tags')),
      memoSource: d.get('memoSource') as string | undefined,
    }))
  const raw = user.data()?.memoStyle
  const style = (MEMO_STYLES as string[]).includes(raw) ? (raw as MemoStyle) : DEFAULT_STYLE
  return { past, style }
}

/** The phone's Vision labels, lower-cased names. */
export function labelsOf(tags: unknown): string[] {
  const labels = (tags as { labels?: { name?: string }[] } | undefined)?.labels
  return Array.isArray(labels) ? labels.map((l) => String(l?.name ?? '').toLowerCase()).filter(Boolean) : []
}

/** The photographer's offset for the memo doc's fields (the phone's, else the place's). */
export async function photoOffsetMin(patientUid: string, lat: number | null, lng: number | null, tzOffsetMin?: number | null): Promise<number> {
  return localOffsetMin(patientUid, lat, lng, tzOffsetMin)
}

/**
 * Today's weather as one short Korean line, from the 기상청 단기예보 (data.go.kr)
 * — only when the memoWeather flag is on and KMA_API_KEY is set. Off by
 * default and not wired to the network yet: returns null.
 */
export async function fetchWeather(_lat: number | null, _lng: number | null): Promise<string | null> {
  try {
    if (!process.env.KMA_API_KEY || !(await flagOn('memoWeather'))) return null
  } catch (err) {
    logger.warn('[memo-v2] weather flag read failed', { err: String(err) })
    return null
  }
  return null
}
