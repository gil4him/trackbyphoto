/**
 * Family-managed elders + device pairing.
 *
 * The family sets everything up; the elder never signs in with Google:
 *
 *   createManagedElder  A signed-in family member registers a parent. Creates
 *                       a Firebase Auth user for the elder, the users/{uid}
 *                       settings doc (accountType 'managed'), two consents
 *                       granted by the family member on the elder's behalf,
 *                       and a guardian membership for the family member.
 *
 *   createPairingLink   Family issues a one-time 8-character code that links
 *                       the elder's phone. Only its SHA-256 hash is stored.
 *                       'onboard' (no phone linked yet) lives 24 h; 'repair'
 *                       (re-linking an account that already has a phone)
 *                       lives 1 h. A new link cancels any older pending one.
 *
 *   pairDevice          The elder's phone, signed in anonymously, redeems the
 *                       code. First-time links and in-person QR links issue a
 *                       custom token immediately. A remote re-link waits for
 *                       family approval (the main link-theft vector: a
 *                       forwarded link to an account that already has data).
 *
 *   approvePairing      Family approves or denies a waiting re-link.
 *   completePairing     The waiting phone collects its token once approved.
 *
 *   unlinkDevice        Family disconnects a phone. Firestore rules check the
 *                       device's status on every elder-session read/write, so
 *                       the phone loses access immediately.
 *
 *   deleteManagedElder  The guardian erases the parent's account and all of
 *                       its data (부모님 삭제).
 *
 * Elder sessions are custom tokens with claims { elder: true, deviceId }.
 * Rules use those claims to keep the elder's phone to capture + reading its
 * own records: no settings writes, no invites, no membership removal.
 */

import { createHash, randomInt } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore, FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { WorkerError as HttpsError, type Caller } from '../context.js'

// Crockford-style alphabet without look-alikes (0/O, 1/I/L, U): 30^8 ≈ 6.6e11.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LEN = 8
const ONBOARD_TTL_MS = 24 * 3600 * 1000
const REPAIR_TTL_MS = 3600 * 1000

// Wrong-code throttling. 30^8 codes make guessing hopeless anyway; this keeps
// a scripted attacker from even trying at volume.
const FAIL_LIMIT_PER_CALLER = 5
const FAIL_LIMIT_GLOBAL = 200
const FAIL_WINDOW_MS = 10 * 60 * 1000

const ANON_CLEANUP_DELAY_MS = 2 * 60 * 1000

export const PAIR_ORIGIN = 'https://trackbyphoto.web.app'

type PairingPurpose = 'onboard' | 'repair'
type PairingMode = 'remote' | 'qr'
type PairingStatus = 'pending' | 'awaiting-approval' | 'approved' | 'denied' | 'used' | 'expired'

interface Pairing {
  patientUid: string
  codeHash: string
  purpose: PairingPurpose
  mode: PairingMode
  status: PairingStatus
  createdBy: string
  expiresAt: Timestamp
  claimedBy?: string | null
  deviceInfo?: { name: string; platform: string } | null
}

interface Settings {
  cadence?: 'realtime' | 'daily' | 'weekly'
  autoMode?: boolean
  bigText?: boolean
}

function requireAuth(caller: Caller): string {
  if (!caller.uid) throw new HttpsError('unauthenticated', 'sign in required')
  return caller.uid
}

// Family actions need a real (Google) account. Anonymous pairing sessions and
// elder sessions carry no email, so this keeps both out.
function requireFamilyAccount(caller: Caller): string {
  const uid = requireAuth(caller)
  if (!caller.email) throw new HttpsError('permission-denied', 'a signed-in family account is required')
  return uid
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export function normalizePairCode(input: string): string {
  return (input || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

function genPairCode(): string {
  let s = ''
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return s
}

export function pairLink(code: string): string {
  return `${PAIR_ORIGIN}/pair?c=${code}`
}

/** Active guardian/admin family member of this elder (never the elder). */
async function canManageElder(callerUid: string, patientUid: string): Promise<boolean> {
  if (callerUid === patientUid) return false
  const snap = await getFirestore().collection('memberships').doc(`${patientUid}_${callerUid}`).get()
  const m = snap.data() as { status?: string; role?: string } | undefined
  return m?.status === 'active' && (m.role === 'guardian' || m.role === 'admin')
}

async function activeFamilyUids(patientUid: string): Promise<string[]> {
  const snap = await getFirestore()
    .collection('memberships')
    .where('patientUid', '==', patientUid)
    .where('status', '==', 'active')
    .get()
  return snap.docs.map((d) => (d.data() as { caregiverUid: string }).caregiverUid)
}

function familyNotice(recipientUid: string, patientUid: string, actorUid: string, type: string, message: string) {
  return {
    recipientUid,
    patientUid,
    actorUid,
    type,
    message,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  }
}

async function elderName(patientUid: string): Promise<string> {
  const snap = await getFirestore().collection('users').doc(patientUid).get()
  const name = (snap.data() as { patientName?: unknown } | undefined)?.patientName
  return (typeof name === 'string' && name.trim()) || '부모님'
}

function cleanDeviceInfo(raw: unknown): { name: string; platform: string } {
  const d = (raw && typeof raw === 'object' ? raw : {}) as { name?: unknown; platform?: unknown }
  const name = typeof d.name === 'string' ? d.name.trim().slice(0, 40) : ''
  const platform = typeof d.platform === 'string' ? d.platform.trim().slice(0, 20) : ''
  return { name: name || '휴대폰', platform: platform || 'web' }
}

// ── wrong-code throttle (in memory; resets on worker restart) ───────────────
const failures = new Map<string, number[]>()
let globalFailures: number[] = []

function recent(times: number[], now: number) {
  return times.filter((t) => now - t < FAIL_WINDOW_MS)
}

function checkThrottle(callerUid: string) {
  const now = Date.now()
  globalFailures = recent(globalFailures, now)
  const mine = recent(failures.get(callerUid) ?? [], now)
  failures.set(callerUid, mine)
  if (mine.length >= FAIL_LIMIT_PER_CALLER || globalFailures.length >= FAIL_LIMIT_GLOBAL) {
    throw new HttpsError('resource-exhausted', 'too many attempts; try again later')
  }
}

function recordFailure(callerUid: string) {
  const now = Date.now()
  failures.set(callerUid, [...recent(failures.get(callerUid) ?? [], now), now])
  globalFailures.push(now)
}

/** Test hook. */
export function resetPairingThrottle() {
  failures.clear()
  globalFailures = []
}

// Anonymous users exist only to reach the worker's request queue. Delete them
// once the phone has switched to its elder session — after a delay, because
// the phone still needs its anonymous ID token to read this request's result.
function scheduleAnonCleanup(uid: string) {
  const t = setTimeout(async () => {
    try {
      const u = await getAuth().getUser(uid)
      if (u.providerData.length === 0 && !u.email && !u.customClaims?.elder) await getAuth().deleteUser(uid)
    } catch {
      // Already gone, or not ours to delete.
    }
  }, ANON_CLEANUP_DELAY_MS)
  t.unref?.()
}

// ────────────────────────────────────────────────────────────────────────────
// createManagedElder
// ────────────────────────────────────────────────────────────────────────────

/** What a voice_reply consent covers (also written by the app's 음성 답장 switch). */
const VOICE_CONSENT_SCOPE = '음성 답장 녹음과 받아쓴 글을 가족과 공유'

interface CreateManagedElderRequest {
  patientName: string
  settings?: Settings
  consentTextVersion?: string
  /** The consent screen the guardian accepted included voice replies. */
  voiceConsent?: boolean
}

export async function createManagedElder(caller: Caller, data: CreateManagedElderRequest): Promise<{ patientUid: string }> {
  const callerUid = requireFamilyAccount(caller)
  const patientName = typeof data?.patientName === 'string' ? data.patientName.trim().slice(0, 20) : ''
  if (!patientName) throw new HttpsError('invalid-argument', 'patientName required')

  const s = data.settings ?? {}
  const cadence = s.cadence === 'realtime' || s.cadence === 'weekly' ? s.cadence : 'daily'
  const consentTextVersion = data.consentTextVersion || 'managed-v1'

  const elder = await getAuth().createUser({ displayName: patientName })
  const patientUid = elder.uid
  const db = getFirestore()

  const sensitiveRef = db.collection('consents').doc()
  const thirdPartyRef = db.collection('consents').doc()
  const voiceRef = data.voiceConsent === true ? db.collection('consents').doc() : null
  const consentBase = {
    patientUid,
    grantedBy: 'guardian' as const,
    guardianUid: callerUid,
    consentTextVersion,
    timestamp: FieldValue.serverTimestamp(),
  }

  const batch = db.batch()
  batch.set(db.collection('users').doc(patientUid), {
    patientName,
    recipients: [],
    cadence,
    autoMode: s.autoMode !== false,
    bigText: s.bigText !== false,
    retention: '90',
    accountType: 'managed',
    voiceEnabled: !!voiceRef,
    createdBy: callerUid,
    lastModifiedBy: callerUid,
    lastModifiedAt: FieldValue.serverTimestamp(),
  })
  batch.set(sensitiveRef, { ...consentBase, type: 'sensitive_data', scope: '메모 텍스트와 사진' })
  batch.set(thirdPartyRef, { ...consentBase, type: 'third_party_share', scope: '메모 + 위치 + 사진을 가족과 공유' })
  if (voiceRef) batch.set(voiceRef, { ...consentBase, type: 'voice_reply', scope: VOICE_CONSENT_SCOPE })
  batch.set(db.collection('memberships').doc(`${patientUid}_${callerUid}`), {
    patientUid,
    caregiverUid: callerUid,
    caregiverName: caller.name || caller.email || '',
    role: 'guardian',
    status: 'active',
    invitedBy: callerUid,
    consentId: thirdPartyRef.id,
    createdAt: FieldValue.serverTimestamp(),
    acceptedAt: FieldValue.serverTimestamp(),
    revokedAt: null,
  })
  batch.set(db.collection('auditLogs').doc(), {
    patientUid,
    actorUid: callerUid,
    action: 'elder.create',
    details: { sensitiveConsentId: sensitiveRef.id, thirdPartyConsentId: thirdPartyRef.id, voiceConsentId: voiceRef?.id ?? null, consentTextVersion },
    timestamp: FieldValue.serverTimestamp(),
  })
  try {
    await batch.commit()
  } catch (err) {
    await getAuth().deleteUser(patientUid).catch(() => {})
    throw err
  }

  logger.info('[pairing] managed elder created', { patientUid, callerUid })
  return { patientUid }
}

// ────────────────────────────────────────────────────────────────────────────
// createPairingLink
// ────────────────────────────────────────────────────────────────────────────

interface CreatePairingLinkRequest {
  patientUid: string
  mode?: PairingMode
}

interface CreatePairingLinkResponse {
  code: string
  url: string
  purpose: PairingPurpose
  expiresAt: string
}

export async function createPairingLink(caller: Caller, data: CreatePairingLinkRequest): Promise<CreatePairingLinkResponse> {
  const callerUid = requireFamilyAccount(caller)
  const patientUid = data?.patientUid
  if (!patientUid || typeof patientUid !== 'string') throw new HttpsError('invalid-argument', 'patientUid required')
  if (!(await canManageElder(callerUid, patientUid))) {
    throw new HttpsError('permission-denied', 'only a guardian or admin family member can link a phone')
  }
  const db = getFirestore()
  const user = await db.collection('users').doc(patientUid).get()
  if ((user.data() as { accountType?: string } | undefined)?.accountType !== 'managed') {
    throw new HttpsError('failed-precondition', 'this account signs in by itself')
  }

  const mode: PairingMode = data.mode === 'qr' ? 'qr' : 'remote'
  // A phone was ever linked → the account may hold data → re-link rules.
  const everLinked = !(await db.collection('users').doc(patientUid).collection('devices').limit(1).get()).empty
  const purpose: PairingPurpose = everLinked ? 'repair' : 'onboard'
  const expiresAt = Timestamp.fromMillis(Date.now() + (purpose === 'onboard' ? ONBOARD_TTL_MS : REPAIR_TTL_MS))
  const code = genPairCode()

  const open = await db.collection('pairings')
    .where('patientUid', '==', patientUid)
    .where('status', 'in', ['pending', 'awaiting-approval', 'approved'])
    .get()

  const ref = db.collection('pairings').doc()
  const batch = db.batch()
  open.forEach((d) => batch.update(d.ref, { status: 'expired' }))
  batch.set(ref, {
    patientUid,
    codeHash: hashCode(code),
    purpose,
    mode,
    status: 'pending',
    createdBy: callerUid,
    expiresAt,
    claimedBy: null,
    deviceInfo: null,
    createdAt: FieldValue.serverTimestamp(),
  })
  batch.set(db.collection('auditLogs').doc(), {
    patientUid,
    actorUid: callerUid,
    action: 'pairing.create',
    details: { pairingId: ref.id, purpose, mode },
    timestamp: FieldValue.serverTimestamp(),
  })
  await batch.commit()

  logger.info('[pairing] link created', { patientUid, callerUid, purpose, mode })
  return { code, url: pairLink(code), purpose, expiresAt: expiresAt.toDate().toISOString() }
}

// ────────────────────────────────────────────────────────────────────────────
// pairDevice / completePairing
// ────────────────────────────────────────────────────────────────────────────

type PairResult =
  | { status: 'paired'; customToken: string; patientUid: string; deviceId: string }
  | { status: 'awaiting-approval'; pairingId: string }

async function issueDevice(
  ref: DocumentReference,
  p: Pairing,
  callerUid: string,
  device: { name: string; platform: string },
): Promise<PairResult> {
  const db = getFirestore()
  const deviceRef = db.collection('users').doc(p.patientUid).collection('devices').doc()
  const customToken = await getAuth().createCustomToken(p.patientUid, { elder: true, deviceId: deviceRef.id })
  const name = await elderName(p.patientUid)
  const family = await activeFamilyUids(p.patientUid)

  // Transaction so two phones redeeming the same code can't both get in.
  const expected = p.status
  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Pairing | undefined
    if (!fresh || fresh.status !== expected) throw new HttpsError('failed-precondition', 'code already used')
    tx.update(ref, { status: 'used', usedAt: FieldValue.serverTimestamp(), claimedBy: callerUid, deviceInfo: device })
    tx.set(deviceRef, {
      name: device.name,
      platform: device.platform,
      pairedAt: FieldValue.serverTimestamp(),
      pairedVia: ref.id,
      status: 'active',
      revokedAt: null,
      revokedBy: null,
    })
    tx.set(db.collection('auditLogs').doc(), {
      patientUid: p.patientUid,
      actorUid: callerUid,
      action: 'device.pair',
      details: { pairingId: ref.id, deviceId: deviceRef.id, purpose: p.purpose, mode: p.mode, device },
      timestamp: FieldValue.serverTimestamp(),
    })
    for (const uid of family) {
      tx.set(
        db.collection('notifications').doc(),
        familyNotice(uid, p.patientUid, callerUid, 'device.pair', `${name}님 휴대폰(${device.name})이 연결되었어요.`),
      )
    }
  })
  scheduleAnonCleanup(callerUid)

  logger.info('[pairing] device paired', { patientUid: p.patientUid, deviceId: deviceRef.id, purpose: p.purpose, mode: p.mode })
  return { status: 'paired', customToken, patientUid: p.patientUid, deviceId: deviceRef.id }
}

export async function pairDevice(caller: Caller, data: { code?: string; device?: unknown }): Promise<PairResult> {
  const callerUid = requireAuth(caller)
  checkThrottle(callerUid)
  const code = normalizePairCode(data?.code ?? '')
  if (code.length !== CODE_LEN) {
    recordFailure(callerUid)
    throw new HttpsError('invalid-argument', `${CODE_LEN}-character code required`)
  }
  const device = cleanDeviceInfo(data?.device)

  const db = getFirestore()
  const found = await db.collection('pairings').where('codeHash', '==', hashCode(code)).limit(1).get()
  if (found.empty) {
    recordFailure(callerUid)
    throw new HttpsError('not-found', 'code not found')
  }
  const ref = found.docs[0].ref
  const p = found.docs[0].data() as Pairing

  // Retry from the same phone while it waits for approval.
  if (p.status === 'awaiting-approval' && p.claimedBy === callerUid) {
    return { status: 'awaiting-approval', pairingId: ref.id }
  }
  if (p.status !== 'pending') throw new HttpsError('failed-precondition', 'code already used')
  if (p.expiresAt.toMillis() < Date.now()) {
    await ref.update({ status: 'expired' })
    throw new HttpsError('deadline-exceeded', 'code expired')
  }

  if (p.purpose === 'onboard' || p.mode === 'qr') {
    return issueDevice(ref, p, callerUid, device)
  }

  // Remote re-link of an account that already has a phone: ask the family.
  const name = await elderName(p.patientUid)
  const family = await activeFamilyUids(p.patientUid)
  const batch = db.batch()
  // Precondition: fails if another phone claimed the code since we read it.
  batch.update(
    ref,
    { status: 'awaiting-approval', claimedBy: callerUid, deviceInfo: device, claimedAt: FieldValue.serverTimestamp() },
    { lastUpdateTime: found.docs[0].updateTime },
  )
  for (const uid of family) {
    batch.set(
      db.collection('notifications').doc(),
      familyNotice(uid, p.patientUid, callerUid, 'device.approval', `${name}님 계정에 새 휴대폰(${device.name}) 연결 요청이 있어요. 설정에서 승인해 주세요.`),
    )
  }
  try {
    await batch.commit()
  } catch {
    throw new HttpsError('failed-precondition', 'code already used')
  }
  logger.info('[pairing] re-link awaiting approval', { patientUid: p.patientUid, pairingId: ref.id })
  return { status: 'awaiting-approval', pairingId: ref.id }
}

export async function approvePairing(caller: Caller, data: { pairingId?: string; approve?: boolean }): Promise<{ status: PairingStatus }> {
  const callerUid = requireFamilyAccount(caller)
  const pairingId = data?.pairingId
  if (!pairingId || typeof pairingId !== 'string') throw new HttpsError('invalid-argument', 'pairingId required')
  const db = getFirestore()
  const ref = db.collection('pairings').doc(pairingId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'pairing not found')
  const p = snap.data() as Pairing
  if (!(await canManageElder(callerUid, p.patientUid))) {
    throw new HttpsError('permission-denied', 'only a guardian or admin family member can approve')
  }
  if (p.status !== 'awaiting-approval') throw new HttpsError('failed-precondition', 'nothing to approve')
  if (p.expiresAt.toMillis() < Date.now()) {
    await ref.update({ status: 'expired' })
    throw new HttpsError('deadline-exceeded', 'request expired')
  }

  const status: PairingStatus = data.approve === false ? 'denied' : 'approved'
  const batch = db.batch()
  batch.update(ref, { status, decidedBy: callerUid, decidedAt: FieldValue.serverTimestamp() })
  batch.set(db.collection('auditLogs').doc(), {
    patientUid: p.patientUid,
    actorUid: callerUid,
    action: status === 'approved' ? 'pairing.approve' : 'pairing.deny',
    details: { pairingId, device: p.deviceInfo ?? null },
    timestamp: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  logger.info('[pairing] decision', { patientUid: p.patientUid, pairingId, status })
  return { status }
}

export async function completePairing(caller: Caller, data: { pairingId?: string }): Promise<PairResult> {
  const callerUid = requireAuth(caller)
  const pairingId = data?.pairingId
  if (!pairingId || typeof pairingId !== 'string') throw new HttpsError('invalid-argument', 'pairingId required')
  const ref = getFirestore().collection('pairings').doc(pairingId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'pairing not found')
  const p = snap.data() as Pairing
  if (p.claimedBy !== callerUid) throw new HttpsError('permission-denied', 'not your pairing request')
  if (p.status === 'awaiting-approval') return { status: 'awaiting-approval', pairingId }
  if (p.status !== 'approved') throw new HttpsError('failed-precondition', `pairing ${p.status}`)
  if (p.expiresAt.toMillis() < Date.now()) {
    await ref.update({ status: 'expired' })
    throw new HttpsError('deadline-exceeded', 'pairing expired')
  }
  return issueDevice(ref, p, callerUid, p.deviceInfo ?? cleanDeviceInfo(null))
}

// ────────────────────────────────────────────────────────────────────────────
// unlinkDevice
// ────────────────────────────────────────────────────────────────────────────

export async function unlinkDevice(caller: Caller, data: { patientUid?: string; deviceId?: string }): Promise<{ ok: true }> {
  const callerUid = requireFamilyAccount(caller)
  const { patientUid, deviceId } = data ?? {}
  if (!patientUid || !deviceId) throw new HttpsError('invalid-argument', 'patientUid and deviceId required')
  if (!(await canManageElder(callerUid, patientUid))) {
    throw new HttpsError('permission-denied', 'only a guardian or admin family member can unlink a phone')
  }
  const db = getFirestore()
  const devices = db.collection('users').doc(patientUid).collection('devices')
  const ref = devices.doc(deviceId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'device not found')
  const device = snap.data() as { name?: string; status?: string }

  const name = await elderName(patientUid)
  const family = await activeFamilyUids(patientUid)
  const batch = db.batch()
  batch.update(ref, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: callerUid })
  batch.set(db.collection('auditLogs').doc(), {
    patientUid,
    actorUid: callerUid,
    action: 'device.unlink',
    details: { deviceId, name: device.name ?? null },
    timestamp: FieldValue.serverTimestamp(),
  })
  for (const uid of family.filter((u) => u !== callerUid)) {
    batch.set(
      db.collection('notifications').doc(),
      familyNotice(uid, patientUid, callerUid, 'device.unlink', `${name}님 휴대폰(${device.name ?? '휴대폰'}) 연결이 해제되었어요.`),
    )
  }
  await batch.commit()

  // Last phone gone → also cut every refresh token (rules already deny the
  // revoked device; this stops even a token refresh).
  const stillActive = await devices.where('status', '==', 'active').limit(1).get()
  if (stillActive.empty) await getAuth().revokeRefreshTokens(patientUid).catch((err) =>
    logger.warn('[pairing] revokeRefreshTokens failed', { patientUid, err: String(err) }))

  logger.info('[pairing] device unlinked', { patientUid, deviceId, callerUid })
  return { ok: true }
}

// Every top-level collection whose docs belong to one patient (by patientUid).
const PATIENT_COLLECTIONS = ['memos', 'reactions', 'consents', 'memberships', 'pairings', 'invites', 'auditLogs', 'notifications']

/**
 * 부모님 삭제: the guardian (the family member who registered the parent)
 * erases a family-managed elder entirely — sign-in account (which also cuts
 * off any linked phone), settings, devices, records, photos, consents, and
 * every family member's access. Self-managed accounts can't be deleted here.
 */
export async function deleteManagedElder(caller: Caller, data: { patientUid?: string }): Promise<{ ok: true }> {
  const callerUid = requireFamilyAccount(caller)
  const patientUid = data?.patientUid
  if (!patientUid || typeof patientUid !== 'string') throw new HttpsError('invalid-argument', 'patientUid required')
  if (patientUid === callerUid) throw new HttpsError('permission-denied', 'cannot delete your own account here')
  const db = getFirestore()
  const userRef = db.collection('users').doc(patientUid)
  const user = await userRef.get()
  if ((user.data() as { accountType?: string } | undefined)?.accountType !== 'managed') {
    throw new HttpsError('failed-precondition', 'only a family-managed account can be deleted')
  }
  const m = (await db.collection('memberships').doc(`${patientUid}_${callerUid}`).get()).data() as
    { status?: string; role?: string } | undefined
  if (m?.status !== 'active' || m.role !== 'guardian') {
    throw new HttpsError('permission-denied', 'only the guardian can delete this account')
  }

  // Auth first: once the elder's user is gone no phone can refresh a token,
  // and the devices doc removal below fails every rules check immediately.
  await getAuth().deleteUser(patientUid).catch((err) => {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err
  })

  const writer = db.bulkWriter()
  for (const name of PATIENT_COLLECTIONS) {
    const snap = await db.collection(name).where('patientUid', '==', patientUid).get()
    for (const d of snap.docs) writer.delete(d.ref)
  }
  await writer.close()
  await db.recursiveDelete(userRef)

  // Tests run without a storage emulator; skip rather than reach real GCS.
  if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    // Photos and the parent's voice replies.
    for (const prefix of [`photos/${patientUid}/`, `voice/${patientUid}/`]) {
      await getStorage().bucket().deleteFiles({ prefix }).catch((err) =>
        logger.warn('[pairing] file cleanup failed', { patientUid, prefix, err: String(err) }))
    }
  }

  logger.info('[pairing] managed elder deleted', { patientUid, callerUid })
  return { ok: true }
}
