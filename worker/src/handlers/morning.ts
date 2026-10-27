/**
 * The CEO's morning push (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D13): at 08:00
 * Seoul time, one notice to the admin's own phones with yesterday in a
 * sentence — the same numbers the 오늘 view opens with — plus what waits in
 * 할 일 and any new store review. Behind the `ceoMorningPush` switch (기능
 * 스위치); off by default like every flag the plans table does not set.
 *
 * Sent once per Seoul day: admin_config/dashboard.morning remembers the day,
 * so a restart never sends it twice and a worker down at 8 sends it when it
 * comes back (until 12:00; later than that is no morning).
 */

import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { getPlans } from '../plans.js'
import { localClock } from '../zoned.js'
import { seoulDate, type AdminMetrics } from '../adminMetrics.js'
import { ADMIN_EMAIL } from './admin.js'
import { adminMetrics } from './adminMetrics.js'
import { adminInbox } from './adminInbox.js'
import { loadReviews } from './adminReviews.js'
import { pushToUsers, type PushMessage } from './push.js'

const TZ = 'Asia/Seoul'
export const MORNING_HOUR = 8
const LAST_HOUR = 12
const TICK_MS = 5 * 60_000
const FIRST_TICK_MS = 90_000

/** The worker speaks to its own admin handlers as the admin. */
const WORKER_AS_ADMIN = { uid: 'worker', email: ADMIN_EMAIL, name: 'worker', emailVerified: true }

const n = (v: number) => v.toLocaleString('ko-KR')

/** Yesterday, 할 일 and new reviews in one push. The title is fixed. */
export function morningText(y: AdminMetrics['yesterday'], signupsYesterday: number, todo: number, newReviews: number): PushMessage {
  const first = y.photos > 0 && y.familyReactions > 0
    ? `어제 부모님 ${n(y.parents)}분이 사진 ${n(y.photos)}장을 보냈고, 가족 답장은 ${n(y.familyReactions)}개였어요.`
    : y.photos > 0 ? `어제 부모님 ${n(y.parents)}분이 사진 ${n(y.photos)}장을 보냈고, 가족 답장은 아직 없었어요.`
      : y.familyReactions > 0 ? `어제는 사진이 없었고, 가족 답장은 ${n(y.familyReactions)}개였어요.`
        : '어제는 보낸 사진도, 가족 답장도 없었어요.'
  const tail = [`새 가족 ${n(signupsYesterday)}곳`, `할 일 ${n(todo)}건`, ...(newReviews > 0 ? [`새 리뷰 ${n(newReviews)}개`] : [])].join(', ')
  return { title: 'Daylie 아침 요약', body: `좋은 아침이에요. ${first} ${tail}.`, path: '/admin' }
}

export interface MorningDeps {
  metrics: () => Promise<AdminMetrics>
  todo: () => Promise<number>
  newReviews: () => Promise<number>
  adminUid: () => Promise<string | null>
  push: (uid: string, message: PushMessage) => Promise<number>
  flagOn: () => Promise<boolean>
}

export function defaultMorningDeps(): MorningDeps {
  return {
    metrics: () => adminMetrics(WORKER_AS_ADMIN, { refresh: true }),
    todo: async () => (await adminInbox(WORKER_AS_ADMIN, { refresh: true })).items.length,
    newReviews: async () => (await loadReviews(undefined, true)).summary.new24h,
    adminUid: async () => {
      try { return (await getAuth().getUserByEmail(ADMIN_EMAIL)).uid } catch { return null }
    },
    push: (uid, message) => pushToUsers([uid], message),
    flagOn: async () => (await getPlans())?.flags?.ceoMorningPush === true,
  }
}

export type MorningRun = 'off' | 'not-time' | 'sent-already' | 'no-admin' | { sent: number; body: string }

/** One look at the clock: sends the morning push if it is due and not sent today. */
export async function runMorning(now: Date = new Date(), deps: MorningDeps = defaultMorningDeps()): Promise<MorningRun> {
  if (!(await deps.flagOn())) return 'off'
  const clock = localClock(TZ, now)
  if (clock.hour < MORNING_HOUR || clock.hour >= LAST_HOUR) return 'not-time'
  const today = seoulDate(now.getTime())
  const ref = getFirestore().doc('admin_config/dashboard')
  const morning = ((await ref.get()).data()?.morning ?? {}) as { sentDate?: unknown }
  if (morning.sentDate === today) return 'sent-already'
  const uid = await deps.adminUid()
  if (!uid) { logger.warn('[morning] no admin account to push to'); return 'no-admin' }

  const [m, todo, newReviews] = await Promise.all([deps.metrics(), deps.todo(), deps.newReviews().catch(() => 0)])
  const yesterday = m.days.length >= 2 ? m.days[m.days.length - 2] : null
  const message = morningText(m.yesterday, yesterday?.signups ?? 0, todo, newReviews)
  const sent = await deps.push(uid, message)
  await ref.set({ morning: { sentDate: today, sentAt: FieldValue.serverTimestamp(), body: message.body, devices: sent } }, { merge: true })
  await getFirestore().collection('admin_log').add({ action: 'push.morning', actorUid: 'worker', details: { devices: sent, body: message.body }, timestamp: FieldValue.serverTimestamp() })
  logger.info('[morning] sent', { devices: sent })
  return { sent, body: message.body }
}

/** Every five minutes, from a minute and a half after start. Returns how to stop. */
export function startMorningPush(deps?: MorningDeps): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await runMorning(new Date(), deps ?? defaultMorningDeps()) } catch (err) { logger.error('[morning] failed', { err: String(err) }) } finally { running = false }
  }
  const first = setTimeout(() => void tick(), FIRST_TICK_MS)
  const timer = setInterval(() => void tick(), TICK_MS)
  return () => { clearTimeout(first); clearInterval(timer) }
}
