/**
 * 운영실 오늘 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D1): the numbers, worked
 * out from plain rows so the arithmetic can be tested without Firestore.
 * The handler (handlers/adminMetrics.ts) gathers the rows.
 *
 *   family        a parent with at least one active membership
 *   active parent at least one photo in the last 7 days
 *   north star    families with ≥1 photo and ≥1 reaction (any kind) in the
 *                 last 7 days ÷ all families ("하루를 나눈 가족 (7일)")
 *
 * Days and hours are Seoul's; each series runs oldest → today.
 */

import { tzOffsetMin } from './zoned.js'

export const METRICS_TZ = 'Asia/Seoul'
export const SERIES_DAYS = 30
/** How far back the rows must reach: the series plus one 7-day window. */
export const LOOKBACK_DAYS = SERIES_DAYS + 7
const DAY = 86_400_000

export interface MembershipSpan { patientUid: string; startMs: number; endMs: number | null }
export interface MemoRow { patientUid: string; atMs: number }
export interface ReactionRow { patientUid: string; actorUid: string; atMs: number }

export interface MetricsInput {
  now: number
  parents: { uid: string }[]
  /** Family accounts (the admin left out), by when they signed up. */
  children: { uid: string; createdAtMs: number | null }[]
  memberships: MembershipSpan[]
  memos: MemoRow[]
  reactions: ReactionRow[]
  northStarGoal: number
}

export interface MetricsDay {
  /** YYYY-MM-DD in Seoul */
  date: string
  families: number
  activeParents7d: number
  photos: number
  reactions: number
  signups: number
  /** 0–1; null when there was no family yet. */
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
  /** For the story line: 어제 부모님 n분이 사진 n장을 보냈고, 가족이 n번 마음을 전했어요. */
  yesterday: { parents: number; photos: number; familyReactions: number }
  /** The last SERIES_DAYS days, today last. */
  days: MetricsDay[]
  at: string
}

/** Where a Seoul day starts, for the day holding `ms`. */
export function seoulDayStart(ms: number): number {
  const off = tzOffsetMin(METRICS_TZ, new Date(ms)) * 60_000
  return Math.floor((ms + off) / DAY) * DAY - off
}

export function seoulDate(ms: number): string {
  const off = tzOffsetMin(METRICS_TZ, new Date(ms)) * 60_000
  return new Date(ms + off).toISOString().slice(0, 10)
}

export function seoulHour(ms: number): number {
  const off = tzOffsetMin(METRICS_TZ, new Date(ms)) * 60_000
  return new Date(ms + off).getUTCHours()
}

/** Parents with an active membership at `t` (and still a parent). */
export function familiesAt(spans: MembershipSpan[], parents: Set<string>, t: number): Set<string> {
  const out = new Set<string>()
  for (const s of spans) {
    if (parents.has(s.patientUid) && s.startMs <= t && (s.endMs === null || s.endMs > t)) out.add(s.patientUid)
  }
  return out
}

const within = (ms: number, from: number, to: number) => ms >= from && ms < to

export function computeMetrics(input: MetricsInput, seriesDays = SERIES_DAYS): AdminMetrics {
  const { now } = input
  const parentSet = new Set(input.parents.map((p) => p.uid))
  const today = seoulDayStart(now)

  const days: MetricsDay[] = []
  for (let i = seriesDays - 1; i >= 0; i--) {
    const start = today - i * DAY
    const end = i === 0 ? now + 1 : start + DAY
    const weekFrom = start - 6 * DAY
    const fams = familiesAt(input.memberships, parentSet, end - 1)
    const photosIn = new Set<string>()
    for (const m of input.memos) if (within(m.atMs, weekFrom, end)) photosIn.add(m.patientUid)
    const reactedIn = new Set<string>()
    for (const r of input.reactions) if (within(r.atMs, weekFrom, end)) reactedIn.add(r.patientUid)
    const shared = [...fams].filter((uid) => photosIn.has(uid) && reactedIn.has(uid)).length
    days.push({
      date: seoulDate(start),
      families: fams.size,
      activeParents7d: [...photosIn].filter((uid) => parentSet.has(uid)).length,
      photos: input.memos.filter((m) => within(m.atMs, start, end)).length,
      reactions: input.reactions.filter((r) => within(r.atMs, start, end)).length,
      signups: input.children.filter((c) => c.createdAtMs !== null && within(c.createdAtMs, start, end)).length,
      northStar: fams.size ? shared / fams.size : null,
    })
  }

  const last = days[days.length - 1]
  const byHour = Array.from({ length: 24 }, () => 0)
  for (const m of input.memos) if (within(m.atMs, today, now + 1)) byHour[seoulHour(m.atMs)]++

  const yStart = today - DAY
  const yMemos = input.memos.filter((m) => within(m.atMs, yStart, today))
  const familyShared = familiesAt(input.memberships, parentSet, now)
  const weekFrom = today - 6 * DAY
  const photosIn = new Set(input.memos.filter((m) => within(m.atMs, weekFrom, now + 1)).map((m) => m.patientUid))
  const reactedIn = new Set(input.reactions.filter((r) => within(r.atMs, weekFrom, now + 1)).map((r) => r.patientUid))

  return {
    families: last.families,
    parents: parentSet.size,
    children: input.children.length,
    activeParents7d: last.activeParents7d,
    photosToday: last.photos,
    photosByHourToday: byHour,
    reactionsToday: last.reactions,
    signups7d: days.slice(-7).map((d) => d.signups),
    northStar: {
      families: [...familyShared].filter((uid) => photosIn.has(uid) && reactedIn.has(uid)).length,
      total: familyShared.size,
      series7d: days.slice(-7).map((d) => d.northStar),
      goal: input.northStarGoal,
    },
    yesterday: {
      parents: new Set(yMemos.map((m) => m.patientUid)).size,
      photos: yMemos.length,
      familyReactions: input.reactions.filter((r) => within(r.atMs, yStart, today) && r.actorUid !== r.patientUid).length,
    },
    days,
    at: new Date(now).toISOString(),
  }
}

/** admin_config/dashboard.northStarGoal, when it is a sensible share. */
export function goalOf(v: unknown): number {
  return typeof v === 'number' && v > 0 && v <= 1 ? v : 0.8
}
