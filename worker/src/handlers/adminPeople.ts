/**
 * Admin dashboard (dayliesimple.web.app/admin): the people on the service.
 *
 *   adminListPeople      Every account, from Firebase Auth (the one place a
 *                        family member who never saved settings still shows
 *                        up), joined with their settings doc, family links,
 *                        linked phones and photo count.
 *   adminGetPerson       One account in depth: settings, links both ways,
 *                        phones, pairing codes, consents, the audit trail and
 *                        plan history.
 *   adminDeleteAccount   Erase a parent (managed elder) or a family member,
 *                        through the same sweeps the app itself uses.
 *   adminUnlinkDevice    Disconnect a parent's phone.
 *   adminSetMembership   Change a family link's role, or revoke it.
 *   adminSetPlan         Put a parent on a tier (no payment, no rollout flag).
 *   adminUpdateSettings  Correct a name or a few settings fields.
 *   adminSetDisabled     Block or unblock a sign-in.
 *
 * Only the admin (requireAdmin: the email rules pin to the verified token)
 * may call any of these. Every change writes the person's auditLogs row like
 * the app would, plus one admin_log row that outlives the person — a deleted
 * account takes its auditLogs with it.
 */

import { getAuth, type UserRecord } from 'firebase-admin/auth'
import { getFirestore, FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { WorkerError, type Caller } from '../context.js'
import { PLAN_TIERS, tierOf, type PlanTier } from '../plans.js'
import { requireAdmin } from './admin.js'
import { eraseFamilyAccount } from './account.js'
import { activeFamilyUids, elderName, eraseManagedElder, familyNotice, revokeDevice } from './pairing.js'

export type PersonKind = 'parent' | 'child'

export interface AdminPerson {
  uid: string
  kind: PersonKind
  name: string
  email: string | null
  providers: string[]
  disabled: boolean
  isAdmin: boolean
  createdAt: string | null
  lastSignInAt: string | null
  lastRefreshAt: string | null
  hasSettings: boolean
  plan: { tier: PlanTier; status: string | null; since: string | null; explicit: boolean }
  memos: { count: number; lastAt: string | null }
  /** For a parent: who looks after them. For a child: the parents they look after. */
  links: { active: number; guardians: number }
  devices: { active: number; total: number }
}

export interface AdminLink {
  id: string
  patientUid: string
  caregiverUid: string
  role: string
  status: string
  caregiverName: string | null
  /** The other party as seen from this person: name and, for a family member, email. */
  otherName: string
  otherEmail: string | null
  createdAt: string | null
  acceptedAt: string | null
  revokedAt: string | null
}

export interface AdminPersonDetail extends AdminPerson {
  settings: Record<string, unknown> | null
  linkList: AdminLink[]
  deviceList: { id: string; name: string; platform: string; status: string; pairedAt: string | null; pairedVia: string | null; revokedAt: string | null }[]
  pairings: { id: string; purpose: string; mode: string; status: string; createdAt: string | null; expiresAt: string | null; deviceInfo: unknown }[]
  consents: { id: string; type: string; grantedBy: string; guardianUid: string | null; consentTextVersion: string; timestamp: string | null }[]
  audit: AuditRow[]
  planHistory: AuditRow[]
  counts: { reactions: number; familyPhotos: number; notifications: number }
}

export interface AuditRow {
  id: string
  patientUid: string
  actorUid: string
  action: string
  details: Record<string, unknown>
  timestamp: string | null
}

const ROLES = ['admin', 'viewer', 'guardian'] as const
type Role = (typeof ROLES)[number]

/** Settings fields the dashboard may correct. Never plan / channels / digest /
 *  dayCounters (worker-owned) and never accountType (what the account is). */
const EDITABLE_SETTINGS = ['patientName', 'cadence', 'autoMode', 'bigText', 'retention', 'geoLang', 'voiceEnabled', 'textReplies', 'familyPhotos', 'home', 'memoStyle'] as const

// ── helpers ──────────────────────────────────────────────────────────────────

function iso(v: unknown): string | null {
  if (v instanceof Timestamp) return v.toDate().toISOString()
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string' && v) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

/** Firestore data → JSON-safe (Timestamps to ISO strings), for the app. */
function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString()
  if (Array.isArray(v)) return v.map(plain)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = plain(val)
    return out
  }
  return v
}

function requireUid(v: unknown, what = 'uid'): string {
  if (typeof v !== 'string' || !v.trim()) throw new WorkerError('invalid-argument', `${what} required`)
  return v.trim()
}

export async function allAuthUsers(): Promise<UserRecord[]> {
  const out: UserRecord[] = []
  let pageToken: string | undefined
  do {
    const page = await getAuth().listUsers(1000, pageToken)
    out.push(...page.users)
    pageToken = page.pageToken
  } while (pageToken)
  return out
}

/** A parent is a family-managed account; an Auth user with no email and no
 *  sign-in provider (the shape createManagedElder makes) counts even when
 *  its settings doc is gone. */
export function kindOf(auth: UserRecord, settings: DocumentData | undefined): PersonKind {
  if (settings?.accountType === 'managed') return 'parent'
  if (!auth.email && auth.providerData.length === 0 && !settings) return 'parent'
  return 'child'
}

function nameOf(auth: UserRecord, settings: DocumentData | undefined, kind: PersonKind): string {
  if (kind === 'parent') {
    const n = settings?.patientName
    return (typeof n === 'string' && n.trim()) || auth.displayName || '부모님'
  }
  return auth.displayName || auth.email || auth.uid
}

async function memoStats(db: FirebaseFirestore.Firestore, uid: string): Promise<AdminPerson['memos']> {
  const memos = db.collection('memos').where('patientUid', '==', uid)
  const [count, last] = await Promise.all([
    memos.count().get(),
    memos.orderBy('takenAt', 'desc').limit(1).get(),
  ])
  return { count: count.data().count, lastAt: iso(last.docs[0]?.get('takenAt')) }
}

function planOf(settings: DocumentData | undefined): AdminPerson['plan'] {
  const p = (settings?.plan ?? null) as { tier?: string; status?: string; since?: unknown } | null
  return { tier: tierOf(settings), status: p?.status ?? null, since: iso(p?.since), explicit: !!p?.tier }
}

async function buildPerson(
  db: FirebaseFirestore.Firestore,
  auth: UserRecord,
  settings: DocumentData | undefined,
  memberships: DocumentData[],
  adminEmail: string | null,
): Promise<AdminPerson> {
  const kind = kindOf(auth, settings)
  const mine = kind === 'parent'
    ? memberships.filter((m) => m.patientUid === auth.uid)
    : memberships.filter((m) => m.caregiverUid === auth.uid)
  const active = mine.filter((m) => m.status === 'active')
  let devices = { active: 0, total: 0 }
  if (kind === 'parent') {
    const snap = await db.collection('users').doc(auth.uid).collection('devices').get()
    devices = { active: snap.docs.filter((d) => d.get('status') === 'active').length, total: snap.size }
  }
  return {
    uid: auth.uid,
    kind,
    name: nameOf(auth, settings, kind),
    email: auth.email ?? null,
    providers: auth.providerData.map((p) => p.providerId),
    disabled: auth.disabled,
    isAdmin: !!adminEmail && auth.email === adminEmail,
    createdAt: iso(auth.metadata.creationTime),
    lastSignInAt: iso(auth.metadata.lastSignInTime),
    lastRefreshAt: iso(auth.metadata.lastRefreshTime),
    hasSettings: !!settings,
    plan: planOf(settings),
    memos: await memoStats(db, auth.uid),
    links: { active: active.length, guardians: active.filter((m) => m.role === 'guardian').length },
    devices,
  }
}

async function adminLog(actorUid: string, action: string, targetUid: string, targetName: string, details: Record<string, unknown> = {}) {
  await getFirestore().collection('admin_log').add({
    action, actorUid, targetUid, targetName, details, timestamp: FieldValue.serverTimestamp(),
  })
}

function auditRow(d: FirebaseFirestore.QueryDocumentSnapshot): AuditRow {
  const v = d.data()
  return {
    id: d.id,
    patientUid: String(v.patientUid ?? ''),
    actorUid: String(v.actorUid ?? ''),
    action: String(v.action ?? ''),
    details: (plain(v.details ?? {}) as Record<string, unknown>),
    timestamp: iso(v.timestamp),
  }
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function adminListPeople(caller: Caller): Promise<{ people: AdminPerson[] }> {
  requireAdmin(caller)
  const db = getFirestore()
  const [users, memberships] = await Promise.all([
    allAuthUsers(),
    db.collection('memberships').get().then((s) => s.docs.map((d) => d.data())),
  ])
  const people: AdminPerson[] = []
  // A handful at a time: each person is a few small reads.
  for (let i = 0; i < users.length; i += 10) {
    const chunk = users.slice(i, i + 10)
    const settings = await Promise.all(chunk.map((u) => db.collection('users').doc(u.uid).get()))
    people.push(...await Promise.all(chunk.map((u, j) =>
      buildPerson(db, u, settings[j].data(), memberships, caller.email))))
  }
  people.sort((a, b) => (b.lastSignInAt ?? b.memos.lastAt ?? '').localeCompare(a.lastSignInAt ?? a.memos.lastAt ?? ''))
  return { people }
}

export async function adminGetPerson(caller: Caller, data: { uid?: unknown }): Promise<AdminPersonDetail> {
  requireAdmin(caller)
  const uid = requireUid(data?.uid)
  const db = getFirestore()
  const auth = await getAuth().getUser(uid).catch(() => null)
  if (!auth) throw new WorkerError('not-found', 'no such account')
  const settingsSnap = await db.collection('users').doc(uid).get()
  const settings = settingsSnap.data()

  const [asPatient, asCaregiver] = await Promise.all([
    db.collection('memberships').where('patientUid', '==', uid).get(),
    db.collection('memberships').where('caregiverUid', '==', uid).get(),
  ])
  const rows = [...asPatient.docs, ...asCaregiver.docs]
  const person = await buildPerson(db, auth, settings, rows.map((d) => d.data()), caller.email)

  // The other party on each link, by name (and email for a family member).
  const links: AdminLink[] = []
  for (const d of rows) {
    const m = d.data()
    const otherUid = m.patientUid === uid ? m.caregiverUid : m.patientUid
    const [otherAuth, otherSettings] = await Promise.all([
      getAuth().getUser(otherUid).catch(() => null),
      db.collection('users').doc(otherUid).get(),
    ])
    const otherKind = otherAuth ? kindOf(otherAuth, otherSettings.data()) : 'parent'
    const otherName = otherAuth
      ? nameOf(otherAuth, otherSettings.data(), otherKind)
      : (m.patientUid === uid ? (m.caregiverName || otherUid) : (otherSettings.get('patientName') || otherUid))
    links.push({
      id: d.id,
      patientUid: m.patientUid,
      caregiverUid: m.caregiverUid,
      role: m.role,
      status: m.status,
      caregiverName: m.caregiverName ?? null,
      otherName,
      otherEmail: otherAuth?.email ?? null,
      createdAt: iso(m.createdAt),
      acceptedAt: iso(m.acceptedAt),
      revokedAt: iso(m.revokedAt),
    })
  }

  const [devices, pairings, consents, auditAsPatient, auditAsActor, reactions, familyPhotos, notifications] = await Promise.all([
    db.collection('users').doc(uid).collection('devices').get(),
    db.collection('pairings').where('patientUid', '==', uid).get(),
    db.collection('consents').where('patientUid', '==', uid).get(),
    db.collection('auditLogs').where('patientUid', '==', uid).get(),
    db.collection('auditLogs').where('actorUid', '==', uid).get(),
    db.collection('reactions').where('patientUid', '==', uid).count().get(),
    db.collection('familyPhotos').where('patientUid', '==', uid).count().get(),
    db.collection('notifications').where('recipientUid', '==', uid).count().get(),
  ])
  const byTimeDesc = (a: AuditRow, b: AuditRow) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
  const seen = new Set<string>()
  const audit = [...auditAsPatient.docs, ...auditAsActor.docs]
    .filter((d) => !seen.has(d.id) && seen.add(d.id))
    .map(auditRow)
    .sort(byTimeDesc)

  const cleanSettings = settings ? { ...settings } : null
  if (cleanSettings) delete cleanSettings.dayCounters

  return {
    ...person,
    settings: cleanSettings ? (plain(cleanSettings) as Record<string, unknown>) : null,
    linkList: links,
    deviceList: devices.docs.map((d) => ({
      id: d.id,
      name: String(d.get('name') ?? '휴대폰'),
      platform: String(d.get('platform') ?? ''),
      status: String(d.get('status') ?? ''),
      pairedAt: iso(d.get('pairedAt')),
      pairedVia: (d.get('pairedVia') as string | undefined) ?? null,
      revokedAt: iso(d.get('revokedAt')),
    })),
    pairings: pairings.docs
      .map((d) => ({
        id: d.id,
        purpose: String(d.get('purpose') ?? ''),
        mode: String(d.get('mode') ?? ''),
        status: String(d.get('status') ?? ''),
        createdAt: iso(d.get('createdAt')),
        expiresAt: iso(d.get('expiresAt')),
        deviceInfo: plain(d.get('deviceInfo') ?? null),
      }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, 10),
    consents: consents.docs.map((d) => ({
      id: d.id,
      type: String(d.get('type') ?? ''),
      grantedBy: String(d.get('grantedBy') ?? ''),
      guardianUid: (d.get('guardianUid') as string | null | undefined) ?? null,
      consentTextVersion: String(d.get('consentTextVersion') ?? ''),
      timestamp: iso(d.get('timestamp')),
    })),
    audit: audit.slice(0, 50),
    planHistory: audit.filter((r) => r.action === 'plan.change'),
    counts: {
      reactions: reactions.data().count,
      familyPhotos: familyPhotos.data().count,
      notifications: notifications.data().count,
    },
  }
}

// ── writes ───────────────────────────────────────────────────────────────────

export async function adminDeleteAccount(caller: Caller, data: { uid?: unknown }): Promise<{ ok: true; kind: PersonKind }> {
  requireAdmin(caller)
  const uid = requireUid(data?.uid)
  if (uid === caller.uid) throw new WorkerError('permission-denied', 'the admin account cannot delete itself here')
  const db = getFirestore()
  const auth = await getAuth().getUser(uid).catch(() => null)
  const settings = (await db.collection('users').doc(uid).get()).data()
  if (!auth && !settings) throw new WorkerError('not-found', 'no such account')
  const kind: PersonKind = auth ? kindOf(auth, settings) : (settings?.accountType === 'managed' ? 'parent' : 'child')
  const name = auth ? nameOf(auth, settings, kind) : String(settings?.patientName ?? uid)

  // First, so the record survives the sweep below.
  await adminLog(caller.uid, 'account.delete', uid, name, { kind, email: auth?.email ?? null })
  if (kind === 'parent') await eraseManagedElder(uid)
  else await eraseFamilyAccount(uid)
  logger.info('[admin] account deleted', { uid, kind, by: caller.uid })
  return { ok: true, kind }
}

export async function adminUnlinkDevice(caller: Caller, data: { patientUid?: unknown; deviceId?: unknown }): Promise<{ ok: true }> {
  requireAdmin(caller)
  const patientUid = requireUid(data?.patientUid, 'patientUid')
  const deviceId = requireUid(data?.deviceId, 'deviceId')
  await revokeDevice(patientUid, deviceId, caller.uid)
  await adminLog(caller.uid, 'device.unlink', patientUid, await elderName(patientUid), { deviceId })
  return { ok: true }
}

export async function adminSetMembership(
  caller: Caller,
  data: { patientUid?: unknown; caregiverUid?: unknown; role?: unknown; revoke?: unknown; force?: unknown },
): Promise<{ ok: true }> {
  requireAdmin(caller)
  const patientUid = requireUid(data?.patientUid, 'patientUid')
  const caregiverUid = requireUid(data?.caregiverUid, 'caregiverUid')
  const revoke = data?.revoke === true
  const role = data?.role as Role | undefined
  if (!revoke && !ROLES.includes(role as Role)) {
    throw new WorkerError('invalid-argument', `role must be one of ${ROLES.join(', ')}, or revoke: true`)
  }

  const db = getFirestore()
  const ref = db.collection('memberships').doc(`${patientUid}_${caregiverUid}`)
  const snap = await ref.get()
  if (!snap.exists) throw new WorkerError('not-found', 'membership not found')
  const m = snap.data() as { role?: string; status?: string }

  // A managed elder with no guardian has nobody who can manage or delete
  // them from the app; refuse unless the admin says so.
  const losesGuardian = m.role === 'guardian' && m.status === 'active' && (revoke || role !== 'guardian')
  if (losesGuardian && data?.force !== true) {
    const others = await db.collection('memberships')
      .where('patientUid', '==', patientUid).where('status', '==', 'active').where('role', '==', 'guardian').get()
    if (others.docs.every((d) => d.id === ref.id)) {
      throw new WorkerError('failed-precondition', 'this is the only guardian; pass force to continue')
    }
  }

  const name = await elderName(patientUid)
  const batch = db.batch()
  if (revoke) {
    batch.update(ref, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: caller.uid })
  } else {
    batch.update(ref, { role })
  }
  batch.set(db.collection('auditLogs').doc(), {
    patientUid,
    actorUid: caller.uid,
    action: revoke ? 'membership.revoke' : 'membership.role',
    details: revoke ? { caregiverUid, byAdmin: true } : { caregiverUid, role, byAdmin: true },
    timestamp: FieldValue.serverTimestamp(),
  })
  for (const uid of (await activeFamilyUids(patientUid)).filter((u) => u !== caregiverUid)) {
    batch.set(db.collection('notifications').doc(),
      familyNotice(uid, patientUid, caller.uid, 'caregiver.revoke', `${name}님의 가족 접근이 변경되었어요.`))
  }
  await batch.commit()
  await adminLog(caller.uid, revoke ? 'membership.revoke' : 'membership.role', patientUid, name, { caregiverUid, role: revoke ? null : role })
  logger.info('[admin] membership changed', { patientUid, caregiverUid, revoke, role, by: caller.uid })
  return { ok: true }
}

export async function adminSetPlan(caller: Caller, data: { patientUid?: unknown; tier?: unknown }): Promise<{ ok: true; tier: PlanTier; changed: boolean }> {
  requireAdmin(caller)
  const patientUid = requireUid(data?.patientUid, 'patientUid')
  const tier = data?.tier as PlanTier
  if (!PLAN_TIERS.includes(tier)) throw new WorkerError('invalid-argument', `tier must be one of ${PLAN_TIERS.join(', ')}`)

  const db = getFirestore()
  const userRef = db.collection('users').doc(patientUid)
  const changed = await db.runTransaction(async (tx) => {
    const before = (await tx.get(userRef)).data()
    if (!before) throw new WorkerError('not-found', 'no such account')
    const from = tierOf(before)
    if (before.plan?.tier === tier) return false
    tx.update(userRef, {
      plan: {
        tier,
        status: 'active',
        since: FieldValue.serverTimestamp(),
        changedBy: caller.uid,
        payment: { provider: 'admin' },
      },
    })
    tx.set(db.collection('auditLogs').doc(), {
      patientUid,
      actorUid: caller.uid,
      action: 'plan.change',
      details: { from, to: tier, provider: 'admin', source: 'admin' },
      timestamp: FieldValue.serverTimestamp(),
    })
    return true
  })
  if (changed) await adminLog(caller.uid, 'plan.change', patientUid, await elderName(patientUid), { tier })
  logger.info('[admin] plan set', { patientUid, tier, changed, by: caller.uid })
  return { ok: true, tier, changed }
}

export async function adminUpdateSettings(caller: Caller, data: { uid?: unknown; patch?: unknown }): Promise<{ ok: true }> {
  requireAdmin(caller)
  const uid = requireUid(data?.uid)
  const patch = data?.patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new WorkerError('invalid-argument', 'patch must be an object')
  const keys = Object.keys(patch as object)
  const bad = keys.filter((k) => !(EDITABLE_SETTINGS as readonly string[]).includes(k))
  if (bad.length) throw new WorkerError('invalid-argument', `cannot edit: ${bad.join(', ')}`)
  if (keys.length === 0) throw new WorkerError('invalid-argument', 'nothing to change')
  const p = patch as Record<string, unknown>
  if ('patientName' in p && !(typeof p.patientName === 'string' && p.patientName.trim())) {
    throw new WorkerError('invalid-argument', 'patientName must be a non-empty string')
  }

  const db = getFirestore()
  const ref = db.collection('users').doc(uid)
  const before = (await ref.get()).data()
  if (!before) throw new WorkerError('not-found', 'no settings for this account')
  const name = String(before.patientName ?? uid)
  const batch = db.batch()
  batch.update(ref, { ...p, lastModifiedBy: caller.uid, lastModifiedAt: FieldValue.serverTimestamp() })
  batch.set(db.collection('auditLogs').doc(), {
    patientUid: uid,
    actorUid: caller.uid,
    action: 'settings.update',
    details: { fields: keys, byAdmin: true },
    timestamp: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  await adminLog(caller.uid, 'settings.update', uid, name, { fields: keys })
  return { ok: true }
}

export async function adminSetDisabled(caller: Caller, data: { uid?: unknown; disabled?: unknown }): Promise<{ ok: true; disabled: boolean }> {
  requireAdmin(caller)
  const uid = requireUid(data?.uid)
  if (typeof data?.disabled !== 'boolean') throw new WorkerError('invalid-argument', 'disabled must be true or false')
  if (uid === caller.uid) throw new WorkerError('permission-denied', 'the admin account cannot disable itself')
  const disabled = data.disabled
  const auth = await getAuth().updateUser(uid, { disabled }).catch((err) => {
    if ((err as { code?: string }).code === 'auth/user-not-found') throw new WorkerError('not-found', 'no such account')
    throw err
  })
  // A disabled account's existing sessions last until their token expires;
  // cut them now.
  if (disabled) await getAuth().revokeRefreshTokens(uid).catch((err) =>
    logger.warn('[admin] revokeRefreshTokens failed', { uid, err: String(err) }))
  const db = getFirestore()
  const settings = (await db.collection('users').doc(uid).get()).data()
  const name = nameOf(auth, settings, kindOf(auth, settings))
  await db.collection('auditLogs').add({
    patientUid: uid,
    actorUid: caller.uid,
    action: disabled ? 'account.disable' : 'account.enable',
    details: { byAdmin: true },
    timestamp: FieldValue.serverTimestamp(),
  })
  await adminLog(caller.uid, disabled ? 'account.disable' : 'account.enable', uid, name, { email: auth.email ?? null })
  logger.info('[admin] account ' + (disabled ? 'disabled' : 'enabled'), { uid, by: caller.uid })
  return { ok: true, disabled }
}
