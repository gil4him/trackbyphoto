/**
 * 운영실 성장 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D3): how a family gets from
 * signing up to using Daylie every day, worked out from plain rows so it can
 * be tested without Firestore. The handler (handlers/adminGrowth.ts) gathers
 * the rows.
 *
 * The journey follows each family account that signed up in the last 30
 * days, through the parents it looks after, and counts a stage only when
 * every stage before it was reached too:
 *   가입 → 부모님 휴대폰 연결 (an active phone) → 첫 사진 → 가족 첫 반응 (a
 *   heart or word from someone other than the parent) → 7일 계속 사용 (photos
 *   on ≥4 of the 7 days from the first photo).
 * 설치 and 유료 전환 are not counted here (not connected / payments off).
 */

import { seoulDayStart, seoulDate } from './adminMetrics.js'

const D = 86_400_000

export interface GrowthFamily {
  uid: string
  createdAtMs: number
  /** The parents this account looks after (or did). */
  parents: string[]
  /** How it came in: a family invite link, or registering a parent itself. */
  arrived: 'invite' | 'direct' | 'none'
}
export interface GrowthParent {
  uid: string
  phoneActive: boolean
  firstPhotoMs: number | null
  /** Distinct Seoul days with photos in the 7 days from the first photo. */
  firstWeekDays: number
  familyReacted: boolean
}

export type StageKey = 'signup' | 'phone' | 'firstPhoto' | 'firstReaction' | 'retained7'
export const STAGES: { key: StageKey; label: string }[] = [
  { key: 'signup', label: '가입' },
  { key: 'phone', label: '부모님 휴대폰 연결' },
  { key: 'firstPhoto', label: '첫 사진' },
  { key: 'firstReaction', label: '가족 첫 반응' },
  { key: 'retained7', label: '7일 계속 사용' },
]

export interface FunnelStage { key: StageKey; label: string; count: number; /** Share of the stage before; null for the first. */ rate: number | null }

/** How far each family got, counting a stage only after all the earlier ones. */
export function funnel(families: GrowthFamily[], parents: Map<string, GrowthParent>): FunnelStage[] {
  const reached = (f: GrowthFamily): number => {
    const ps = f.parents.map((u) => parents.get(u)).filter((p): p is GrowthParent => !!p)
    const checks = [
      () => true,
      () => ps.some((p) => p.phoneActive),
      () => ps.some((p) => p.phoneActive && p.firstPhotoMs !== null),
      () => ps.some((p) => p.phoneActive && p.firstPhotoMs !== null && p.familyReacted),
      () => ps.some((p) => p.phoneActive && p.firstPhotoMs !== null && p.familyReacted && p.firstWeekDays >= 4),
    ]
    let n = 0
    while (n < checks.length && checks[n]()) n++
    return n
  }
  const depth = families.map(reached)
  return STAGES.map((s, i) => {
    const count = depth.filter((d) => d > i).length
    const before = i === 0 ? null : depth.filter((d) => d > i - 1).length
    return { ...s, count, rate: before === null ? null : before ? count / before : null }
  })
}

/** The step where the most families stop, with the sentence that says so. */
export function biggestDrop(stages: FunnelStage[]): { from: string; to: string; lost: number; of: number; dropPct: number; text: string } | null {
  let best: ReturnType<typeof biggestDrop> = null
  for (let i = 1; i < stages.length; i++) {
    const of = stages[i - 1].count
    if (!of) continue
    const lost = of - stages[i].count
    const dropPct = Math.round((lost / of) * 100)
    if (lost > 0 && (!best || dropPct > best.dropPct || (dropPct === best.dropPct && lost > best.lost))) {
      best = { from: stages[i - 1].label, to: stages[i].label, lost, of, dropPct, text: '' }
    }
  }
  if (best) best.text = `${best.from} → ${best.to}에서 가장 많이 빠져요. ${best.of}곳 중 ${best.lost}곳이 ${best.to}까지 가지 못했어요.`
  return best
}

/** Monday 00:00 in Seoul for the week holding `ms`. */
export function seoulWeekStart(ms: number): number {
  const day = seoulDayStart(ms)
  const weekday = new Date(`${seoulDate(day)}T00:00:00Z`).getUTCDay() // 0 = Sunday, in Seoul
  return day - ((weekday + 6) % 7) * D
}

export interface CohortRow {
  /** YYYY-MM-DD, the Monday the week starts */
  week: string
  size: number
  /** Weeks 0–4 after each parent's own registration: % with ≥1 photo; null before that week began. */
  pct: (number | null)[]
}

/**
 * Parents registered in each of the last `weeks` weeks (Seoul, from Monday),
 * and the share of them who sent a photo in their week 0, 1, … 4.
 */
export function cohorts(parents: { uid: string; createdAtMs: number }[], memos: { patientUid: string; atMs: number }[], now: number, weeks = 5): CohortRow[] {
  const thisWeek = seoulWeekStart(now)
  const byParent = new Map<string, number[]>()
  for (const m of memos) (byParent.get(m.patientUid) ?? byParent.set(m.patientUid, []).get(m.patientUid)!).push(m.atMs)
  const rows: CohortRow[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = thisWeek - w * 7 * D
    const members = parents.filter((p) => p.createdAtMs >= start && p.createdAtMs < start + 7 * D)
    const pct: (number | null)[] = []
    for (let k = 0; k < 5; k++) {
      const begun = members.filter((p) => p.createdAtMs + k * 7 * D <= now)
      if (!begun.length) { pct.push(null); continue }
      const sent = begun.filter((p) => (byParent.get(p.uid) ?? []).some((t) => t >= p.createdAtMs + k * 7 * D && t < p.createdAtMs + (k + 1) * 7 * D))
      pct.push(Math.round((sent.length / begun.length) * 100))
    }
    rows.push({ week: seoulDate(start), size: members.length, pct })
  }
  return rows
}

/** How the family accounts that signed up came in, as far as the data says. */
export function sources(families: GrowthFamily[]): { invite: number; direct: number; none: number; total: number } {
  return {
    invite: families.filter((f) => f.arrived === 'invite').length,
    direct: families.filter((f) => f.arrived === 'direct').length,
    none: families.filter((f) => f.arrived === 'none').length,
    total: families.length,
  }
}

/** The first membership says how an account came in: invitedBy someone else = an invite link. */
export function arrivalOf(memberships: { caregiverUid: string; invitedBy?: string; startMs: number }[]): GrowthFamily['arrived'] {
  if (!memberships.length) return 'none'
  const first = [...memberships].sort((a, b) => a.startMs - b.startMs)[0]
  return first.invitedBy && first.invitedBy !== first.caregiverUid ? 'invite' : 'direct'
}

/** Distinct Seoul days with a photo in the 7 days from `firstMs`. */
export function firstWeekDays(firstMs: number | null, photosMs: number[]): number {
  if (firstMs === null) return 0
  return new Set(photosMs.filter((t) => t >= firstMs && t < firstMs + 7 * D).map(seoulDate)).size
}
