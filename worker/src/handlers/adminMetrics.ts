/**
 * adminMetrics — the 운영실 오늘 numbers (docs/admin/DAYLIE_ADMIN_DASHBOARD.md
 * D1). Read-only. The answer is kept 5 minutes in memory; `refresh: true`
 * skips that. The arithmetic is in ../adminMetrics.ts.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { Caller } from '../context.js'
import { ADMIN_EMAIL, requireAdmin } from './admin.js'
import { allAuthUsers, kindOf } from './adminPeople.js'
import { computeMetrics, goalOf, LOOKBACK_DAYS, type AdminMetrics, type MembershipSpan } from '../adminMetrics.js'

const CACHE_MS = 5 * 60_000
let cache: { at: number; value: AdminMetrics } | null = null

/** Tests start clean. */
export function resetMetricsCache() { cache = null }

const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

export async function adminMetrics(caller: Caller, data: { refresh?: unknown } = {}): Promise<AdminMetrics> {
  requireAdmin(caller)
  const now = Date.now()
  if (cache && data?.refresh !== true && now - cache.at < CACHE_MS) return cache.value

  const db = getFirestore()
  const since = Timestamp.fromMillis(now - LOOKBACK_DAYS * 86_400_000)
  const [users, settingsSnap, memberships, memos, reactions, dashboard] = await Promise.all([
    allAuthUsers(),
    db.collection('users').select('accountType').get(),
    db.collection('memberships').get(),
    db.collection('memos').where('takenAt', '>=', since).select('patientUid', 'takenAt').get(),
    db.collection('reactions').where('createdAt', '>=', since).select('patientUid', 'actorUid', 'createdAt').get(),
    db.doc('admin_config/dashboard').get(),
  ])
  const settings = new Map(settingsSnap.docs.map((d) => [d.id, d.data()]))
  const parents: { uid: string }[] = []
  const children: { uid: string; createdAtMs: number | null }[] = []
  for (const u of users) {
    if (kindOf(u, settings.get(u.uid)) === 'parent') parents.push({ uid: u.uid })
    else if (u.email !== ADMIN_EMAIL) {
      const t = Date.parse(u.metadata.creationTime)
      children.push({ uid: u.uid, createdAtMs: Number.isNaN(t) ? null : t })
    }
  }
  const spans: MembershipSpan[] = []
  for (const d of memberships.docs) {
    const m = d.data()
    const start = ms(m.acceptedAt) ?? ms(m.createdAt)
    if (start === null) continue
    if (m.status === 'active') spans.push({ patientUid: m.patientUid, startMs: start, endMs: null })
    else if (ms(m.revokedAt) !== null) spans.push({ patientUid: m.patientUid, startMs: start, endMs: ms(m.revokedAt) })
  }

  const value = computeMetrics({
    now,
    parents,
    children,
    memberships: spans,
    memos: memos.docs.flatMap((d) => { const t = ms(d.get('takenAt')); return t === null ? [] : [{ patientUid: String(d.get('patientUid') ?? ''), atMs: t }] }),
    reactions: reactions.docs.flatMap((d) => { const t = ms(d.get('createdAt')); return t === null ? [] : [{ patientUid: String(d.get('patientUid') ?? ''), actorUid: String(d.get('actorUid') ?? ''), atMs: t }] }),
    northStarGoal: goalOf(dashboard.get('northStarGoal')),
  })
  cache = { at: now, value }
  return value
}
