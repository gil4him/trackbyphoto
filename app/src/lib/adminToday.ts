// 운영실 오늘 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D1): the worker's numbers
// (worker/src/adminMetrics.ts) and the words and comparisons built from them.
// Every number on the screen comes from adminMetrics; nothing here invents one.

import { callWorker } from './worker'
import { personFlags, type AdminPerson } from './admin'

export interface MetricsDay {
  date: string
  families: number
  activeParents7d: number
  photos: number
  reactions: number
  signups: number
  northStar: number | null
}

export interface AdminMetrics {
  families: number
  parents: number
  children: number
  activeParents7d: number
  photosToday: number
  photosByHourToday: number[]
  reactionsToday: number
  signups7d: number[]
  northStar: { families: number; total: number; series7d: (number | null)[]; goal: number }
  yesterday: { parents: number; photos: number; familyReactions: number }
  days: MetricsDay[]
  at: string
}

/** The worker counts the whole service; give it time. */
export const adminMetrics = (refresh = false) =>
  callWorker<AdminMetrics>('adminMetrics', refresh ? { refresh: true } : {}, { timeoutMs: 60_000 })

export type Range = 7 | 30
export type Trend = 'up' | 'down' | 'flat'

const SEOUL = 'Asia/Seoul'
export const fmtN = (n: number) => n.toLocaleString('ko-KR')

/** 10월 23일 목요일 · 아침 브리핑 / 좋은 아침이에요, by the clock in Seoul. */
export function briefing(now = new Date()): { line: string; greeting: string } {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: SEOUL, hour: 'numeric', hourCycle: 'h23' }).format(now))
  const date = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL, month: 'long', day: 'numeric', weekday: 'long' }).format(now)
  const [part, greeting] = hour >= 5 && hour < 12 ? ['아침 브리핑', '좋은 아침이에요']
    : hour >= 12 && hour < 18 ? ['오후 브리핑', '좋은 오후예요']
      : ['저녁 브리핑', '좋은 저녁이에요']
  return { line: `${date} · ${part}`, greeting }
}

/** The story card: yesterday in one sentence, as parts so the numbers can be marked. */
export function story(y: AdminMetrics['yesterday']): (string | { n: string })[] {
  const p = { n: `${fmtN(y.parents)}분` }
  const ph = { n: `${fmtN(y.photos)}장` }
  const r = { n: `${fmtN(y.familyReactions)}번` }
  if (y.photos > 0 && y.familyReactions > 0) return ['어제 부모님 ', p, '이 사진 ', ph, '을 보냈고, 가족이 ', r, ' 마음을 전했어요.']
  if (y.photos > 0) return ['어제 부모님 ', p, '이 사진 ', ph, '을 보냈어요. 가족의 하트나 글은 아직 없었어요.']
  if (y.familyReactions > 0) return ['어제는 사진이 없었고, 가족이 ', r, ' 마음을 전했어요.']
  return ['어제는 보낸 사진도, 가족의 하트나 글도 없었어요.']
}

export interface Kpi {
  key: string
  label: string
  value: number
  delta: string
  trend: Trend
  series: number[]
}

const trendOf = (d: number): Trend => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat')
const arrow = (d: number) => (d > 0 ? '▲' : '▼')
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)

/** Today against yesterday, as the 오늘 사진 / 하트·글 답장 cards say it. */
export function vsYesterday(today: number, yesterday: number): { delta: string; trend: Trend } {
  const d = today - yesterday
  if (d === 0) return { delta: '어제와 같아요', trend: 'flat' }
  if (yesterday === 0) return { delta: `${arrow(d)} ${fmtN(Math.abs(d))} 어제보다`, trend: trendOf(d) }
  return { delta: `${arrow(d)} ${Math.round(Math.abs(d) / yesterday * 100)}% 어제보다`, trend: trendOf(d) }
}

/** The five KPI cards, over the last 7 or 30 days. */
export function kpis(m: AdminMetrics, range: Range): Kpi[] {
  const days = m.days.slice(-range)
  const first = days[0]
  const prev = m.days.at(-2)
  const span = range === 7 ? '이번 주' : '30일'

  const famD = m.families - first.families
  const actD = m.activeParents7d - first.activeParents7d
  const share = m.parents ? Math.round(m.activeParents7d / m.parents * 100) : 0

  const photos = range === 7
    ? { label: '오늘 사진', value: m.photosToday, ...vsYesterday(m.photosToday, prev?.photos ?? 0) }
    : { label: '하루 평균 사진', value: Math.round(sum(days.map((d) => d.photos)) / days.length), delta: '최근 30일 평균', trend: 'flat' as Trend }
  const hearts = range === 7
    ? { label: '하트·글 답장', value: m.reactionsToday, ...vsYesterday(m.reactionsToday, prev?.reactions ?? 0) }
    : { label: '하트·글 답장 /일', value: Math.round(sum(days.map((d) => d.reactions)) / days.length), delta: '최근 30일 평균', trend: 'flat' as Trend }

  const signups = sum(days.map((d) => d.signups))
  let signup: { delta: string; trend: Trend }
  if (range === 7) {
    const before = sum(m.days.slice(-14, -7).map((d) => d.signups))
    const d = signups - before
    signup = d === 0 ? { delta: '지난주와 같아요', trend: 'flat' } : { delta: `${arrow(d)} ${fmtN(Math.abs(d))} 지난주보다`, trend: trendOf(d) }
  } else signup = { delta: '최근 30일 합계', trend: 'flat' }

  return [
    { key: 'families', label: '함께하는 가족', value: m.families, delta: famD ? `${arrow(famD)} ${fmtN(Math.abs(famD))} ${span}` : `${span} 변화 없음`, trend: trendOf(famD), series: days.map((d) => d.families) },
    { key: 'active', label: '사진 보낸 부모님', value: m.activeParents7d, delta: `부모님 ${fmtN(m.parents)}분 중 ${share}%`, trend: trendOf(actD), series: days.map((d) => d.activeParents7d) },
    { key: 'photos', ...photos, series: days.map((d) => d.photos) },
    { key: 'hearts', ...hearts, series: days.map((d) => d.reactions) },
    { key: 'signups', label: '신규 가입', value: signups, ...signup, series: days.map((d) => d.signups) },
  ]
}

/** The busiest hour of today between 5시 and 22시, or null with no photo yet. */
export function busiestHour(byHour: number[]): number | null {
  let best: number | null = null
  for (let h = 5; h <= 22; h++) if ((byHour[h] ?? 0) > 0 && (best === null || byHour[h] > byHour[best])) best = h
  return best
}

/** Until 할 일 (D2): the people the dashboard already flags, worst first. */
export function attention(people: AdminPerson[]): { person: AdminPerson; flags: ReturnType<typeof personFlags> }[] {
  const rank = { bad: 0, warn: 1, info: 2 } as const
  return people
    .map((person) => ({ person, flags: personFlags(person).filter((f) => f.tone !== 'info') }))
    .filter((x) => x.flags.length > 0)
    .sort((a, b) => Math.min(...a.flags.map((f) => rank[f.tone])) - Math.min(...b.flags.map((f) => rank[f.tone])))
}
