/**
 * Push notifications to family (Firebase Cloud Messaging).
 *
 * A family member's browser or phone registers its FCM token through the
 * `registerFcmToken` request; tokens are kept in users/{uid}/private/push,
 * which no client can read. When a new photo or a voice reply is announced,
 * the worker also pushes it to each recipient who has tokens and hasn't
 * switched 앱 알림 off (users/{uid}.channels.push).
 *
 * The parent's phone never registers a token and is never pushed to: an
 * elder session can't create requests at all (firestore.rules), and pushes
 * only ever go to the family members a notice is addressed to.
 *
 * A push carries the same one line as the in-app notice and a link into the
 * app, never the photo. Tokens FCM reports as gone are pruned. Everything
 * here is best effort: a failed push must never fail a memo or a reply.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { logger } from '../log.js'
import { WorkerError as HttpsError, type Caller } from '../context.js'
import { flagOn } from '../plans.js'
import { maskPhone, normalizePhone } from '../messenger/index.js'

const APP_URL = process.env.APP_URL || 'https://trackbyphoto.web.app/'
/** One person's devices: phone, tablet, a couple of browsers. */
const MAX_TOKENS = 10
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

/** Injected so tests run without FCM. Returns the tokens that are dead. */
export interface PushDeps {
  send: (tokens: string[], message: PushMessage) => Promise<{ dead: string[] }>
}

export const defaultPushDeps: PushDeps = {
  send: async (tokens, message) => {
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: message.data ?? {},
      webpush: { fcmOptions: { link: appLink(message.path) } },
    })
    return { dead: deadTokens(tokens, res.responses) }
  },
}

/** Absolute link to a page of the app. */
export function appLink(path = ''): string {
  return APP_URL.replace(/\/$/, '') + '/' + path.replace(/^\//, '')
}

/** Which of the tokens FCM says are gone for good (same order as `tokens`). */
export function deadTokens(tokens: string[], responses: Array<{ success: boolean; error?: { code: string } }>): string[] {
  return tokens.filter((_, i) => !responses[i]?.success && DEAD_TOKEN_CODES.has(responses[i]?.error?.code ?? ''))
}

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
      const { dead } = await deps.send(tokens, message)
      if (dead.length > 0) {
        await pushDoc(uid).update({ fcmTokens: FieldValue.arrayRemove(...dead) })
        logger.info('[push] pruned dead tokens', { uid, pruned: dead.length })
      }
      logger.info('[push] sent', { uid, devices: tokens.length - dead.length, type: message.data?.type })
      if (tokens.length > dead.length) reached++
    }
  } catch (err) {
    logger.warn('[push] failed', { err: String(err) })
  }
  return reached
}

// ────────────────────────────────────────────────────────────────────────────
// Requests
// ────────────────────────────────────────────────────────────────────────────

function requireFamilyAccount(caller: Caller): string {
  // Anonymous pairing sessions have no e-mail; a parent's linked phone can't
  // make requests at all.
  if (!caller.uid || !caller.email) throw new HttpsError('permission-denied', 'a signed-in family account is required')
  return caller.uid
}

/** Remember (or forget) one device's FCM token for the caller. */
export async function registerFcmToken(caller: Caller, data: { token?: unknown; remove?: unknown }): Promise<{ ok: true }> {
  const uid = requireFamilyAccount(caller)
  const token = typeof data?.token === 'string' ? data.token : ''
  if (token.length < 20 || token.length > 4096) throw new HttpsError('invalid-argument', 'token required')

  const ref = pushDoc(uid)
  await getFirestore().runTransaction(async (tx) => {
    const current = ((await tx.get(ref)).data()?.fcmTokens as string[] | undefined) ?? []
    const without = current.filter((t) => t !== token)
    // Newest last; the oldest devices fall off the end of the allowance.
    const next = data.remove === true ? without : [...without, token].slice(-MAX_TOKENS)
    tx.set(ref, { fcmTokens: next, updatedAt: FieldValue.serverTimestamp() })
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
