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
 * A push carries the same one line as the in-app notice and a link to the
 * app, never the photo. Tokens FCM reports as gone are pruned. Everything
 * here is best effort: a failed push must never fail a memo or a reply.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { logger } from '../log.js'
import { WorkerError as HttpsError, type Caller } from '../context.js'
import { flagOn } from '../plans.js'

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
      webpush: { fcmOptions: { link: APP_URL } },
    })
    return { dead: deadTokens(tokens, res.responses) }
  },
}

/** Which of the tokens FCM says are gone for good (same order as `tokens`). */
export function deadTokens(tokens: string[], responses: Array<{ success: boolean; error?: { code: string } }>): string[] {
  return tokens.filter((_, i) => !responses[i]?.success && DEAD_TOKEN_CODES.has(responses[i]?.error?.code ?? ''))
}

const pushDoc = (uid: string) => getFirestore().doc(`users/${uid}/private/push`)

/** Push one message to each of these people's devices. Never throws. */
export async function pushToUsers(uids: string[], message: PushMessage, deps: PushDeps = defaultPushDeps): Promise<void> {
  try {
    if (uids.length === 0 || !(await flagOn('pushFamily'))) return
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
    }
  } catch (err) {
    logger.warn('[push] failed', { err: String(err) })
  }
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

/** How the caller wants to be told: 앱 알림 / 이메일 요약 / 카카오톡 요약. */
export async function setChannels(caller: Caller, data: Record<string, unknown>): Promise<{ channels: Record<string, boolean> }> {
  const uid = requireFamilyAccount(caller)
  const changes: Record<string, boolean> = {}
  for (const key of CHANNELS) {
    if (typeof data?.[key] === 'boolean') changes[key] = data[key] as boolean
  }
  if (Object.keys(changes).length === 0) throw new HttpsError('invalid-argument', 'nothing to change')

  const db = getFirestore()
  const userRef = db.doc(`users/${uid}`)
  const channels = await db.runTransaction(async (tx) => {
    const current = ((await tx.get(userRef)).data()?.channels as Record<string, boolean> | undefined) ?? { push: true, email: true, messenger: false }
    const next = { ...current, ...changes }
    tx.set(userRef, { channels: next }, { merge: true })
    tx.set(db.collection('auditLogs').doc(), {
      patientUid: uid,
      actorUid: uid,
      action: 'channels.update',
      details: changes,
      timestamp: FieldValue.serverTimestamp(),
    })
    return next
  })
  return { channels }
}
