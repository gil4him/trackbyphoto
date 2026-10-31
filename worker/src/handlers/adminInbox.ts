/**
 * adminInbox — 운영실 할 일 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D2). Read-only
 * over the service; the rules are in ../adminInbox.ts. What the rules found is
 * kept 5 minutes in memory (`refresh: true` skips that); what the admin did
 * with each item (admin_config/dashboard.inbox, written by the page) is read
 * every time, and spent entries there are cleared.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { Caller } from '../context.js'
import { getPlans, PLAN_TIERS, tierOf } from '../plans.js'
import { requireAdmin } from './admin.js'
import { allAuthUsers, kindOf, nameOf } from './adminPeople.js'
import { history, memoStats } from '../systemHistory.js'
import {
  applyStates, costOf, inboxItems, statesOf,
  type InboxAccount, type InboxItem, type InboxParent,
} from '../adminInbox.js'

const CACHE_MS = 5 * 60_000
let cache: { at: number; items: InboxItem[] } | null = null

/** Tests start clean. */
export function resetInboxCache() { cache = null }

const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

async function findItems(now: number, dashboard: Record<string, unknown> | undefined): Promise<InboxItem[]> {
  const db = getFirestore()
  const since = Timestamp.fromMillis(now - 11 * 86_400_000)
  const [users, settingsSnap, memberships, memos, beat, plans] = await Promise.all([
    allAuthUsers(),
    db.collection('users').get(),
    db.collection('memberships').where('status', '==', 'active').get(),
    db.collection('memos').where('takenAt', '>=', since).select('patientUid', 'takenAt').get(),
    db.doc('system/worker').get(),
    getPlans(),
  ])
  const settings = new Map(settingsSnap.docs.map((d) => [d.id, d.data()]))
  const active = memberships.docs.map((d) => d.data()).filter((m) => m.caregiverUid !== m.patientUid)

  const accounts: InboxAccount[] = []
  const parents: InboxParent[] = []
  for (const u of users) {
    const s = settings.get(u.uid)
    const kind = kindOf(u, s)
    accounts.push({ uid: u.uid, kind, name: nameOf(u, s, kind), email: u.email ?? null, disabled: u.disabled })
    if (kind !== 'parent') continue
    const mine = active.filter((m) => m.patientUid === u.uid)
    const created = Date.parse(u.metadata.creationTime)
    parents.push({
      uid: u.uid, name: nameOf(u, s, kind), createdAtMs: Number.isNaN(created) ? null : created, tier: tierOf(s),
      family: mine.length, guardians: mine.filter((m) => m.role === 'guardian').length, devicesActive: 0,
    })
  }
  // A few parents at a time: one small read each.
  for (let i = 0; i < parents.length; i += 10) {
    const chunk = parents.slice(i, i + 10)
    const snaps = await Promise.all(chunk.map((p) => db.collection('users').doc(p.uid).collection('devices').where('status', '==', 'active').get()))
    chunk.forEach((p, j) => { p.devicesActive = snaps[j].size })
  }

  const familyLimits: Record<string, number> = {}
  for (const t of PLAN_TIERS) if (typeof plans?.[t]?.familyMembers === 'number') familyLimits[t] = plans[t]!.familyMembers

  return inboxItems({
    now,
    parents,
    accounts,
    memos: memos.docs.flatMap((d) => { const t = ms(d.get('takenAt')); return t === null ? [] : [{ patientUid: String(d.get('patientUid') ?? ''), atMs: t }] }),
    worker: {
      lastSeenMs: ms(beat.get('lastSeen')),
      modelUp: beat.exists ? beat.get('modelUp') !== false : null,
      pushFailAtMs: beat.get('push.failAt') ?? null,
      pushOkAtMs: beat.get('push.okAt') ?? null,
      pushFailCode: beat.get('push.failCode') ?? null,
    },
    // This worker's memo times over the last 15 minutes (시스템, memory only).
    memoP50Ms: memoStats(history().memoTimes, now).p50Last15,
    familyLimits,
    cost: costOf(dashboard, now),
  })
}

export async function adminInbox(caller: Caller, data: { refresh?: unknown } = {}): Promise<{ items: InboxItem[]; hidden: number; at: string }> {
  requireAdmin(caller)
  const now = Date.now()
  const db = getFirestore()
  const ref = db.doc('admin_config/dashboard')
  const dashboard = (await ref.get()).data()
  if (!cache || data?.refresh === true || now - cache.at >= CACHE_MS) cache = { at: now, items: await findItems(now, dashboard) }
  const { open, hidden, spent } = applyStates(cache.items, statesOf(dashboard), now)
  if (spent.length) {
    await ref.update(Object.fromEntries(spent.map((id) => [`inbox.${id}`, FieldValue.delete()]))).catch(() => {})
  }
  return { items: open, hidden, at: new Date(cache.at).toISOString() }
}
