/**
 * Push notifications to family (Firebase Cloud Messaging).
 *
 * A family member's browser or installed app registers its FCM token through the
 * `registerFcmToken` request; tokens are kept in users/{uid}/private/push,
 * which no client can read. When a new photo or a voice reply is announced,
 * the worker also pushes it to each recipient who has tokens and hasn't
 * switched 앱 알림 off (users/{uid}.channels.push).
 *
 * A parent's paired phone registers its token against its device record
 * (the only request an elder session may make besides reportDevice,
 * firestore.rules). It is pushed only a photo from family, a family heart or
 * word, and the family's app-update notice (handlers/device.ts).
 *
 * A push carries the same one line as the in-app notice and a link into the
 * app, never the photo. Tokens FCM reports as gone are pruned. Any other
 * failure (an invalid APNs key, say) is logged as '[push] not delivered'
 * with FCM's codes: FCM accepts the batch either way, so without that line
 * nothing in the log shows that no phone got the push. Everything here is
 * best effort: a failed push must never fail a memo or a reply.
 *
 * Keeping a family member's tokens current: an app that got a new token
 * sends the one it `replaces`, which is dropped. Each register stamps
 * fcmSeen[token]; a token not registered again for STALE_TOKEN_DAYS (the app
 * re-registers at least daily while used) is dropped the next time another
 * device of that person registers. That clears the token a deleted app left
 * behind, which FCM may go on accepting.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging'
import { logger } from '../log.js'
import { WorkerError as HttpsError, type Caller } from '../context.js'
import { flagOn } from '../plans.js'
import { maskPhone, normalizePhone } from '../messenger/index.js'
import { APP_URL } from '../config.js'

/** One person's devices: phone, tablet, a couple of browsers. */
const MAX_TOKENS = 10
/** A token not registered again for this long is a device that is gone. */
export const STALE_TOKEN_DAYS = 60
/** FCM's ways of saying a token will never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

export interface PushMessage {
  title: string
  body: string
  /** String key/values the app can read when the push is opened. */
  data?: Record<string, string>
  /** Path inside the app that a tap opens (default: the home screen). */
  path?: string
}

/** What FCM said about one batch: the tokens that are dead, and how many
 *  sends failed for any other reason, by FCM's error code. */
export interface SendResult {
  dead: string[]
  failed?: Record<string, number>
}

/** Injected so tests run without FCM. */
export interface PushDeps {
  send: (tokens: string[], message: PushMessage) => Promise<SendResult>
}

/**
 * One message for all of a person's devices. A browser opens `link` when the
 * notice is tapped; the installed apps read `data` and open the right place
 * themselves.
 */
export function fcmMessage(tokens: string[], message: PushMessage): MulticastMessage {
  // The number on the app icon. The home-screen web app reads data.badge;
  // the store apps only show what the phone's own badge field says.
  const badge = Number(message.data?.badge)
  const hasBadge = message.data?.badge !== undefined && Number.isFinite(badge)
  return {
    tokens,
    notification: { title: message.title, body: message.body },
    data: message.data ?? {},
    webpush: { fcmOptions: { link: appLink(message.path) } },
    // iPhone app: without this the banner arrives silently.
    apns: { payload: { aps: { sound: 'default', ...(hasBadge ? { badge } : {}) } } },
    ...(hasBadge ? { android: { notification: { notificationCount: badge } } } : {}),
  }
}

export const defaultPushDeps: PushDeps = {
  send: async (tokens, message) => {
    const res = await getMessaging().sendEachForMulticast(fcmMessage(tokens, message))
    return { dead: deadTokens(tokens, res.responses), failed: otherFailures(res.responses) }
  },
}

/** Where a tapped notice opens in the web app (read by app/src/lib/openFromUrl.ts). */
export const openPath = {
  memo: (patientUid: string, memoId: string) => `?open=memo&p=${encodeURIComponent(patientUid)}&m=${encodeURIComponent(memoId)}`,
  home: (patientUid: string) => `?open=home&p=${encodeURIComponent(patientUid)}`,
  today: (patientUid: string) => `?open=today&p=${encodeURIComponent(patientUid)}`,
}

/** How many notices this person hasn't seen: the number on the app icon. */
async function unreadCount(uid: string): Promise<number> {
  const snap = await getFirestore().collection('notifications')
    .where('recipientUid', '==', uid).where('read', '==', false).count().get()
  return snap.data().count
}

/** Absolute link to a page of the app. */
export function appLink(path = ''): string {
  return APP_URL + '/' + path.replace(/^\//, '')
}

/** Which of the tokens FCM says are gone for good (same order as `tokens`). */
export function deadTokens(tokens: string[], responses: Array<{ success: boolean; error?: { code: string } }>): string[] {
  return tokens.filter((_, i) => !responses[i]?.success && DEAD_TOKEN_CODES.has(responses[i]?.error?.code ?? ''))
}

/** Sends that failed for a reason other than a dead token, counted by code. */
export function otherFailures(responses: Array<{ success: boolean; error?: { code: string } }>): Record<string, number> {
  const failed: Record<string, number> = {}
  for (const r of responses) {
    const code = r.error?.code ?? 'unknown'
    if (!r.success && !DEAD_TOKEN_CODES.has(code)) failed[code] = (failed[code] ?? 0) + 1
  }
  return failed
}

/** How many of `tokens` reached FCM's next hop, and a log line for the rest. */
function delivered(tokens: string[], result: SendResult, context: Record<string, unknown>): number {
  const failed = result.failed ?? {}
  const failures = Object.values(failed).reduce((a, b) => a + b, 0)
  if (failures > 0) logger.warn('[push] not delivered', { ...context, failed })
  return Math.max(0, tokens.length - result.dead.length - failures)
}

/** The last characters of each token: enough to tell devices apart in the log. */
const tails = (tokens: string[]) => tokens.map((t) => t.slice(-6))

const pushDoc = (uid: string) => getFirestore().doc(`users/${uid}/private/push`)

/** Push one message to each of these people's devices; returns how many
 *  people it reached. Never throws. */
export async function pushToUsers(uids: string[], message: PushMessage, deps: PushDeps = defaultPushDeps): Promise<number> {
  let reached = 0
  try {
    if (uids.length === 0 || !(await flagOn('pushFamily'))) return 0
    const db = getFirestore()
    for (const uid of new Set(uids)) {
      const tokens = ((await pushDoc(uid).get()).data()?.fcmTokens as string[] | undefined) ?? []
      if (tokens.length === 0) continue
      const channels = (await db.doc(`users/${uid}`).get()).data()?.channels as { push?: boolean } | undefined
      if (channels?.push === false) continue
      // The home-screen web app sets its icon badge from this, even while closed.
      const badge = await unreadCount(uid).catch(() => null)
      const own = badge == null ? message : { ...message, data: { ...message.data, badge: String(badge) } }
      const result = await deps.send(tokens, own)
      const { dead } = result
      if (dead.length > 0) {
        await pushDoc(uid).set({
          fcmTokens: FieldValue.arrayRemove(...dead),
          fcmSeen: Object.fromEntries(dead.map((t) => [t, FieldValue.delete()])),
        }, { merge: true })
        logger.info('[push] pruned dead tokens', { uid, pruned: dead.length })
      }
      const devices = delivered(tokens, result, { uid, type: message.data?.type })
      logger.info('[push] sent', { uid, devices, tokens: tails(tokens), type: message.data?.type })
      if (devices > 0) reached++
    }
  } catch (err) {
    logger.warn('[push] failed', { err: String(err) })
  }
  return reached
}

/** The number on the parent's icon: photos from family not looked at, and
 *  hearts and words from family not read. Small lists; counted here. */
export async function elderBadge(patientUid: string): Promise<number> {
  const db = getFirestore()
  const photos = await db.collection('familyPhotos')
    .where('patientUid', '==', patientUid).where('status', '==', 'ready').limit(100).get()
  const unseen = photos.docs.filter((d) => !d.data().seenAt && !d.data().seenAtMs).length
  const reactions = await db.collection('reactions')
    .where('patientUid', '==', patientUid).where('status', '==', 'ready').limit(200).get()
  const unread = reactions.docs.filter((d) => d.data().actorUid !== patientUid && !d.data().readByElderAt).length
  return unseen + unread
}

/**
 * One message to a parent's paired phones (the tokens registerFcmToken keeps
 * per device), carrying the icon number. Only a photo from family, a
 * family heart or word, and the family's app-update notice ever call this.
 * Returns how many phones it reached. Never throws.
 */
export async function pushToElder(patientUid: string, message: PushMessage, deps: PushDeps = defaultPushDeps): Promise<number> {
  try {
    if (!(await flagOn('pushFamily'))) return 0
    const ref = pushDoc(patientUid)
    const byDevice = ((await ref.get()).data()?.elderTokens as Record<string, string> | undefined) ?? {}
    const tokens = Object.values(byDevice).filter((t) => typeof t === 'string' && t)
    if (tokens.length === 0) return 0
    const badge = await elderBadge(patientUid).catch(() => null)
    const own = badge == null ? message : { ...message, data: { ...message.data, badge: String(badge) } }
    const result = await deps.send(tokens, own)
    const { dead } = result
    if (dead.length > 0) {
      const gone = Object.fromEntries(Object.entries(byDevice).filter(([, t]) => dead.includes(t)).map(([id]) => [id, FieldValue.delete()]))
      await ref.set({ elderTokens: gone }, { merge: true })
      logger.info('[push] pruned dead elder tokens', { patientUid, pruned: dead.length })
    }
    const devices = delivered(tokens, result, { patientUid, type: message.data?.type })
    logger.info('[push] sent to parent', { patientUid, devices, tokens: tails(tokens), type: message.data?.type })
    return devices > 0 ? 1 : 0
  } catch (err) {
    logger.warn('[push] to parent failed', { patientUid, err: String(err) })
    return 0
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Requests
// ────────────────────────────────────────────────────────────────────────────

/** The caller is a parent's paired phone: signed in as the parent, and the
 *  device it names is one of the parent's active phones. */
export async function requireElderDevice(caller: Caller, deviceId: unknown): Promise<string> {
  if (!caller.uid) throw new HttpsError('unauthenticated', 'sign in required')
  if (typeof deviceId !== 'string' || !deviceId) throw new HttpsError('permission-denied', 'a signed-in family account is required')
  const device = await getFirestore().doc(`users/${caller.uid}/devices/${deviceId}`).get()
  if (!device.exists || device.data()?.status !== 'active') throw new HttpsError('permission-denied', 'not a linked phone')
  return caller.uid
}

export function requireFamilyAccount(caller: Caller): string {
  // Anonymous pairing sessions have no e-mail; a parent's linked phone can't
  // make requests at all.
  if (!caller.uid || !caller.email) throw new HttpsError('permission-denied', 'a signed-in family account is required')
  return caller.uid
}

/** Remember (or forget) one device's FCM token for the caller. `replaces`:
 *  the token this device had before, dropped (family accounts). */
export async function registerFcmToken(caller: Caller, data: { token?: unknown; remove?: unknown; deviceId?: unknown; replaces?: unknown }): Promise<{ ok: true }> {
  const token = typeof data?.token === 'string' ? data.token : ''
  if (token.length < 20 || token.length > 4096) throw new HttpsError('invalid-argument', 'token required')
  // A parent's paired phone (its session is the parent's uid, with no e-mail)
  // registers against the device it was paired as, so unlinking that phone
  // takes its token with it (pairing.ts revokeDevice).
  if (!caller.email && typeof data?.deviceId === 'string') {
    const uid = await requireElderDevice(caller, data.deviceId)
    const deviceId = data.deviceId
    await pushDoc(uid).set({
      elderTokens: { [deviceId]: data.remove === true ? FieldValue.delete() : token },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { ok: true }
  }
  const uid = requireFamilyAccount(caller)

  const replaces = typeof data?.replaces === 'string' ? data.replaces : null
  const ref = pushDoc(uid)
  await getFirestore().runTransaction(async (tx) => {
    const doc = (await tx.get(ref)).data() ?? {}
    const current = (doc.fcmTokens as string[] | undefined) ?? []
    const seenBefore = (doc.fcmSeen as Record<string, Timestamp> | undefined) ?? {}
    const now = Timestamp.now()
    const staleBefore = now.toMillis() - STALE_TOKEN_DAYS * 24 * 60 * 60 * 1000
    const without = current.filter((t) => t !== token && t !== replaces)
    // A device that registers clears its own gone tokens; a remove never
    // sweeps, so an account is not emptied without a device registering.
    const kept = data.remove === true ? without : without.filter((t) => {
      const seen = seenBefore[t]
      return !seen || seen.toMillis() >= staleBefore
    })
    // Newest last; the oldest devices fall off the end of the allowance.
    const next = data.remove === true ? kept : [...kept, token].slice(-MAX_TOKENS)
    // Tokens from before fcmSeen are stamped now, so they age from today.
    const fcmSeen = Object.fromEntries(next.map((t) => [t, t === token ? now : seenBefore[t] ?? now]))
    // Merge: a parent's elderTokens may share this doc.
    tx.set(ref, { fcmTokens: next, fcmSeen, updatedAt: FieldValue.serverTimestamp() }, { mergeFields: ['fcmTokens', 'fcmSeen', 'updatedAt'] })
  })
  return { ok: true }
}

const CHANNELS = ['push', 'email', 'messenger'] as const

/** Where the worker keeps a family member's phone number; no client can read it. */
export const contactDoc = (uid: string) => getFirestore().doc(`users/${uid}/private/contact`)

/**
 * How the caller wants to be told: 앱 알림 / 이메일 요약 / 카카오톡 요약.
 * 카카오톡 요약 needs a phone number: `phone` sets it (kept in
 * users/{uid}/private/contact; the users doc only shows a masked copy).
 */
export async function setChannels(caller: Caller, data: Record<string, unknown>): Promise<{ channels: Record<string, unknown> }> {
  const uid = requireFamilyAccount(caller)
  const changes: Record<string, boolean> = {}
  for (const key of CHANNELS) {
    if (typeof data?.[key] === 'boolean') changes[key] = data[key] as boolean
  }
  const phone = data?.phone === undefined ? undefined : normalizePhone(data.phone)
  if (phone === null) throw new HttpsError('invalid-argument', 'phone number not recognised')
  if (Object.keys(changes).length === 0 && !phone) throw new HttpsError('invalid-argument', 'nothing to change')

  const db = getFirestore()
  const userRef = db.doc(`users/${uid}`)
  const channels = await db.runTransaction(async (tx) => {
    const [userSnap, contactSnap] = await Promise.all([tx.get(userRef), tx.get(contactDoc(uid))])
    const current = (userSnap.data()?.channels as Record<string, unknown> | undefined) ?? { push: true, email: true, messenger: false }
    const next: Record<string, unknown> = { ...current, ...changes }
    if (phone) next.messengerTo = maskPhone(phone)
    if (next.messenger === true && !phone && !contactSnap.data()?.phone) {
      throw new HttpsError('failed-precondition', 'a phone number is needed for messenger delivery')
    }
    if (phone) tx.set(contactDoc(uid), { phone, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(userRef, { channels: next }, { merge: true })
    tx.set(db.collection('auditLogs').doc(), {
      patientUid: uid,
      actorUid: uid,
      action: 'channels.update',
      // The number itself stays out of the log.
      details: { ...changes, ...(phone ? { phone: 'set' } : {}) },
      timestamp: FieldValue.serverTimestamp(),
    })
    return next
  })
  return { channels }
}
