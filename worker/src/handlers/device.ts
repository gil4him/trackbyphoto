/**
 * The parent's phone and its app version.
 *
 *   reportDevice     the parent's paired phone says which store-app version it
 *                    runs; kept on its device record (users/{uid}/devices/{id}.app).
 *   sendUpdateNudge  a guardian/admin family member asks that phone, by push, to
 *                    update the app. At most once a day per parent; only when the
 *                    phone is behind the store or its version is unknown (a phone
 *                    from before 1.0.3 never reports one). system/app holds the
 *                    stores' latest versions (storeVersions.ts).
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { WorkerError as HttpsError, type Caller } from '../context.js'
import { APP_STORE_URL, PLAY_STORE_URL } from '../config.js'
import { resolveGeoLang } from '../travel.js'
import { compareVersions } from '../storeVersions.js'
import { canManageElder } from './pairing.js'
import { pushToElder, requireElderDevice, requireFamilyAccount, type PushMessage } from './push.js'

const NUDGE_EVERY_MS = 24 * 3600_000
const VERSION_RE = /^\d+\.\d+(\.\d+)?$/
const PLATFORMS = ['ios', 'android'] as const
type Platform = (typeof PLATFORMS)[number]

/**
 * The update notice's words (owner-approved, 2026-10-27). Changing them needs
 * the owner's approval. A phone that reported its version (1.0.3 or later)
 * opens the store when the notice is tapped; an older one only opens the
 * camera, so it is told where to go.
 */
export const UPDATE_NUDGE_TEXT = {
  ko: {
    tap: '새 버전이 나왔어요. 눌러서 업데이트해 주세요',
    ios: '새 버전이 나왔어요. 앱스토어에서 업데이트해 주세요',
    android: '새 버전이 나왔어요. Play 스토어에서 업데이트해 주세요',
  },
  en: {
    tap: 'A new version is out. Tap to update.',
    ios: 'A new version is out. Please update it in the App Store.',
    android: 'A new version is out. Please update it in the Play Store.',
  },
} as const

const STORE_URL: Record<Platform, string> = { ios: APP_STORE_URL, android: PLAY_STORE_URL }

const isPlatform = (p: unknown): p is Platform => PLATFORMS.includes(p as Platform)

// ────────────────────────────────────────────────────────────────────────────
// reportDevice
// ────────────────────────────────────────────────────────────────────────────

export async function reportDevice(
  caller: Caller,
  data: { deviceId?: unknown; version?: unknown; build?: unknown; platform?: unknown },
): Promise<{ ok: true }> {
  // Only the parent's own paired phone (no e-mail), for its own device record.
  if (caller.email) throw new HttpsError('permission-denied', 'only a linked phone reports its version')
  const uid = await requireElderDevice(caller, data?.deviceId)
  const { version, build, platform } = data ?? {}
  if (typeof version !== 'string' || version.length > 20 || !VERSION_RE.test(version)) {
    throw new HttpsError('invalid-argument', 'version required (x.y.z)')
  }
  if (build !== undefined && build !== null && (typeof build !== 'string' || build.length > 32)) {
    throw new HttpsError('invalid-argument', 'build must be a short string')
  }
  if (!isPlatform(platform)) throw new HttpsError('invalid-argument', 'platform must be ios or android')
  await getFirestore().doc(`users/${uid}/devices/${data.deviceId as string}`).update({
    app: { version, build: typeof build === 'string' ? build : null, platform, reportedAt: FieldValue.serverTimestamp() },
  })
  return { ok: true }
}

// ────────────────────────────────────────────────────────────────────────────
// sendUpdateNudge
// ────────────────────────────────────────────────────────────────────────────

export interface UpdateNudgeDeps {
  pushElder: (patientUid: string, message: PushMessage) => Promise<number>
}
const defaultDeps: UpdateNudgeDeps = { pushElder: (p, m) => pushToElder(p, m) }

export async function sendUpdateNudge(
  caller: Caller,
  data: { patientUid?: unknown },
  deps: UpdateNudgeDeps = defaultDeps,
): Promise<{ reached: number; nextAt: number }> {
  const callerUid = requireFamilyAccount(caller)
  const patientUid = typeof data?.patientUid === 'string' ? data.patientUid : ''
  if (!patientUid) throw new HttpsError('invalid-argument', 'patientUid required')
  if (!(await canManageElder(callerUid, patientUid))) {
    throw new HttpsError('permission-denied', 'only a guardian or admin family member can send an update notice')
  }

  const db = getFirestore()
  const active = await db.collection(`users/${patientUid}/devices`).where('status', '==', 'active').limit(1).get()
  if (active.empty) throw new HttpsError('failed-precondition', 'no linked phone')
  const deviceId = active.docs[0].id
  const device = active.docs[0].data() as { platform?: unknown; app?: { version?: unknown; platform?: unknown } }
  const appVersion = typeof device.app?.version === 'string' ? device.app.version : null
  const platform = isPlatform(device.app?.platform) ? device.app.platform : isPlatform(device.platform) ? device.platform : null
  // A phone paired from the website has no store app to update.
  if (!platform) throw new HttpsError('failed-precondition', 'no store app on that phone')

  const store = (await db.doc('system/app').get()).data() as Partial<Record<Platform, { version?: unknown }>> | undefined
  const latest = typeof store?.[platform]?.version === 'string' ? (store[platform]!.version as string) : null
  if (appVersion && latest && compareVersions(appVersion, latest) >= 0) {
    throw new HttpsError('failed-precondition', 'already up to date')
  }

  // Worker-only state (no client can read or write users/{uid}/private).
  const stateRef = db.doc(`users/${patientUid}/private/updateNudge`)
  const now = Date.now()
  await db.runTransaction(async (tx) => {
    const last = (await tx.get(stateRef)).get('lastSentAt') as Timestamp | undefined
    if (last && now - last.toMillis() < NUDGE_EVERY_MS) {
      throw new HttpsError('resource-exhausted', 'an update notice went out in the last 24 hours', { nextAt: last.toMillis() + NUDGE_EVERY_MS })
    }
  })

  const words = UPDATE_NUDGE_TEXT[(await resolveGeoLang(patientUid)) === 'en' ? 'en' : 'ko']
  const storeUrl = STORE_URL[platform]
  const reached = await deps.pushElder(patientUid, {
    title: 'Daylie',
    body: appVersion ? words.tap : words[platform],
    data: { type: 'app.update', patientUid, storeUrl },
  })
  if (reached === 0) throw new HttpsError('failed-precondition', 'no phone can get pushes')

  const batch = db.batch()
  batch.set(stateRef, { lastSentAt: Timestamp.fromMillis(now), lastBy: callerUid, lastDeviceId: deviceId }, { merge: true })
  batch.set(db.collection('auditLogs').doc(), {
    patientUid,
    actorUid: callerUid,
    action: 'device.updateNudge',
    details: { deviceId, appVersion, latest, platform, reached },
    timestamp: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  logger.info('[device] update nudge', { patientUid, actorUid: callerUid, deviceId, appVersion, latest, platform, reached })
  return { reached, nextAt: now + NUDGE_EVERY_MS }
}
