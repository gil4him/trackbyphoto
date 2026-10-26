/**
 * adminGrowth — 운영실 성장 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D3). Read-only.
 * The journey of the last 30 days' sign-ups, weekly cohorts, how families
 * came in, and 90 days of active parents and families. Kept 5 minutes in
 * memory; `refresh: true` skips that. The arithmetic is in ../adminGrowth.ts
 * and ../adminMetrics.ts.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { Caller } from '../context.js'
import { ADMIN_EMAIL, requireAdmin } from './admin.js'
import { allAuthUsers, kindOf } from './adminPeople.js'
import { computeMetrics, type MembershipSpan } from '../adminMetrics.js'
import {
  arrivalOf, biggestDrop, cohorts, firstWeekDays, funnel, origins, sources,
  type CohortRow, type FunnelStage, type GrowthFamily, type GrowthParent,
} from '../adminGrowth.js'
import { installs, trafficDeps, type Installs } from '../traffic/index.js'
import { logger } from '../log.js'

const D = 86_400_000
const CACHE_MS = 5 * 60_000
const TREND_DAYS = 90

export interface AdminGrowth {
  funnel: FunnelStage[]
  drop: ReturnType<typeof biggestDrop>
  cohorts: CohortRow[]
  sources: ReturnType<typeof sources>
  /** 어디서 들어왔나 by the invite link and the platform the app stamped (D11). */
  origins: ReturnType<typeof origins>
  /** 설치 from the stores' reports (D11); a store without its env says `unconfigured`. */
  installs: Installs
  trend: { dates: string[]; activeParents: number[]; families: number[] }
  at: string
}

let cache: { at: number; value: AdminGrowth } | null = null
export function resetGrowthCache() { cache = null }

const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

export async function adminGrowth(caller: Caller, data: { refresh?: unknown } = {}): Promise<AdminGrowth> {
  requireAdmin(caller)
  const now = Date.now()
  if (cache && data?.refresh !== true && now - cache.at < CACHE_MS) return cache.value

  const db = getFirestore()
  const since = Timestamp.fromMillis(now - (TREND_DAYS + 7) * D)
  // The stores' reports are read alongside; a store that fails never costs
  // the rest of the answer (it says `error` in its own card).
  const storeInstalls = installs(trafficDeps(now)).catch((err): Installs => {
    logger.warn('[adminGrowth] installs failed', { err: String(err) })
    const bad = { state: 'error' as const, missing: [], error: String((err as Error).message ?? err).slice(0, 120), days: [], total: 0, known: 0 }
    return { ios: bad, android: bad }
  })
  const [users, settingsSnap, membershipSnap, memoSnap] = await Promise.all([
    allAuthUsers(),
    db.collection('users').select('accountType', 'arrival').get(),
    db.collection('memberships').get(),
    db.collection('memos').where('takenAt', '>=', since).select('patientUid', 'takenAt').get(),
  ])
  const settings = new Map(settingsSnap.docs.map((d) => [d.id, d.data()]))
  const memberships = membershipSnap.docs.map((d) => d.data())
  const memos = memoSnap.docs.flatMap((d) => { const t = ms(d.get('takenAt')); return t === null ? [] : [{ patientUid: String(d.get('patientUid') ?? ''), atMs: t }] })

  const parentList: { uid: string; createdAtMs: number }[] = []
  const children: { uid: string; createdAtMs: number | null }[] = []
  for (const u of users) {
    const t = Date.parse(u.metadata.creationTime)
    if (kindOf(u, settings.get(u.uid)) === 'parent') { if (!Number.isNaN(t)) parentList.push({ uid: u.uid, createdAtMs: t }) }
    else if (u.email !== ADMIN_EMAIL) children.push({ uid: u.uid, createdAtMs: Number.isNaN(t) ? null : t })
  }
  const parentSet = new Set(parentList.map((p) => p.uid))

  // The journey: family accounts from the last 30 days.
  const recent = children.filter((c) => c.createdAtMs !== null && c.createdAtMs >= now - 30 * D)
  const families: GrowthFamily[] = recent.map((c) => {
    const mine = memberships
      .filter((m) => m.caregiverUid === c.uid && m.patientUid !== c.uid && (m.status === 'active' || m.status === 'revoked'))
      .map((m) => ({ caregiverUid: c.uid, patientUid: String(m.patientUid), invitedBy: m.invitedBy as string | undefined, startMs: ms(m.acceptedAt) ?? ms(m.createdAt) ?? 0 }))
    const a = settings.get(c.uid)?.arrival as { platform?: unknown; ref?: unknown } | undefined
    const arrival = a && typeof a.platform === 'string' ? { platform: a.platform, ref: typeof a.ref === 'string' ? a.ref : null } : null
    return { uid: c.uid, createdAtMs: c.createdAtMs!, parents: [...new Set(mine.map((m) => m.patientUid))].filter((u) => parentSet.has(u)), arrived: arrivalOf(mine), arrival }
  })
  const involved = [...new Set(families.flatMap((f) => f.parents))]
  const parents = new Map<string, GrowthParent>()
  for (let i = 0; i < involved.length; i += 10) {
    const chunk = involved.slice(i, i + 10)
    const rows = await Promise.all(chunk.map(async (uid) => {
      const [devices, first, reactions] = await Promise.all([
        db.collection('users').doc(uid).collection('devices').where('status', '==', 'active').limit(1).get(),
        db.collection('memos').where('patientUid', '==', uid).orderBy('takenAt', 'asc').limit(1).get(),
        db.collection('reactions').where('patientUid', '==', uid).select('actorUid').limit(200).get(),
      ])
      const firstMs = ms(first.docs[0]?.get('takenAt'))
      let week: number[] = []
      if (firstMs !== null) {
        const snap = await db.collection('memos').where('patientUid', '==', uid)
          .where('takenAt', '>=', Timestamp.fromMillis(firstMs)).where('takenAt', '<', Timestamp.fromMillis(firstMs + 7 * D)).select('takenAt').get()
        week = snap.docs.flatMap((d) => { const t = ms(d.get('takenAt')); return t === null ? [] : [t] })
      }
      return {
        uid, phoneActive: !devices.empty, firstPhotoMs: firstMs, firstWeekDays: firstWeekDays(firstMs, week),
        familyReacted: reactions.docs.some((r) => r.get('actorUid') && r.get('actorUid') !== uid),
      } satisfies GrowthParent
    }))
    for (const r of rows) parents.set(r.uid, r)
  }
  const stages = funnel(families, parents)

  // 90 days of active parents and families (the 오늘 arithmetic, longer).
  const spans: MembershipSpan[] = []
  for (const m of memberships) {
    const start = ms(m.acceptedAt) ?? ms(m.createdAt)
    if (start === null) continue
    if (m.status === 'active') spans.push({ patientUid: m.patientUid, startMs: start, endMs: null })
    else if (ms(m.revokedAt) !== null) spans.push({ patientUid: m.patientUid, startMs: start, endMs: ms(m.revokedAt) })
  }
  const series = computeMetrics({ now, parents: parentList, children, memberships: spans, memos, reactions: [], northStarGoal: 0.8 }, TREND_DAYS).days

  const value: AdminGrowth = {
    funnel: stages,
    drop: biggestDrop(stages),
    cohorts: cohorts(parentList, memos, now),
    sources: sources(families),
    origins: origins(families),
    installs: await storeInstalls,
    trend: { dates: series.map((d) => d.date), activeParents: series.map((d) => d.activeParents7d), families: series.map((d) => d.families) },
    at: new Date(now).toISOString(),
  }
  cache = { at: now, value }
  return value
}
