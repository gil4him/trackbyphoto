/**
 * The evening digest: what the parent's day looked like, in two or three
 * sentences, sent to the family.
 *
 * At the parent's digest hour (users/{uid}.digest, default 20:00 Seoul time)
 * the worker gathers the day's memos, has the local model summarise them
 * (text only; same rules as memos: only what the memos say), adds the
 * parent's own replies (hearts, voice replies) and writes digests/{id}.
 * Each family member then gets it by:
 *   - an in-app notice and a push, always,
 *   - e-mail, unless they switched 이메일 요약 off (and e-mail is configured),
 *   - messenger (알림톡 / WhatsApp / SMS), only when the parent's plan
 *     includes it and they switched 카카오톡 요약 on.
 * Messages carry one line and a link to the digest page, never a photo.
 *
 * Plans with a weekly highlight also get one on Sundays; plans with a
 * monthly recap get one on the 1st. Plans with a check-in get "오늘 아직
 * 사진이 없어요" on a day without photos (handlers/checkin.ts).
 *
 * There is no paid model: if the Mac mini's model is down the digest waits,
 * and after a couple of hours goes out with a plain sentence instead.
 * Everything here runs only while the `digest` flag is on.
 */

import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { WorkerError as HttpsError, type Caller } from '../context.js'
import { generateSummary, LlmGenerationError, LlmUnavailableError } from '../llm/ollama.js'
import { withModelLock } from '../llm/lock.js'
import { areaOf, type DigestPromptArgs, type DigestSpan } from '../llm/prompt.js'
import { mailerFromEnv, type Mailer } from '../mail.js'
import { providerFor, type MessengerProvider } from '../messenger/index.js'
import { getPlans, tierOf, type PlansDoc } from '../plans.js'
import { localClock, localDayStart, tzOffsetMin, validTz, type LocalClock } from '../zoned.js'
import { isOwnerOrAdminCaregiver } from './caregiver.js'
import { checkIn } from './checkin.js'
import { appLink, contactDoc, pushToUsers, type PushMessage } from './push.js'

export interface DigestSettings {
  cadence: 'daily' | 'weekly'
  /** Hour of the parent's day the digest goes out (0-23). */
  hourLocal: number
  tz: string
}

export const DEFAULT_DIGEST: DigestSettings = { cadence: 'daily', hourLocal: 20, tz: 'Asia/Seoul' }

/** Model down: wait this many hours past the digest hour before sending a plain sentence. */
const WAIT_FOR_MODEL_HOURS = 2
/** A summary the model keeps getting wrong: tries before the plain sentence. */
const MAX_SUMMARY_ATTEMPTS = 3
/** Memo ids kept on a digest (a month can hold many). */
const MAX_MEMO_IDS = 200
const TICK_MS = 10 * 60 * 1000
const FIRST_TICK_MS = 2 * 60 * 1000

export function digestSettings(user: FirebaseFirestore.DocumentData | undefined): DigestSettings {
  const d = (user?.digest ?? {}) as Partial<DigestSettings>
  return {
    cadence: d.cadence === 'weekly' ? 'weekly' : 'daily',
    hourLocal: Number.isInteger(d.hourLocal) && d.hourLocal! >= 0 && d.hourLocal! <= 23 ? d.hourLocal! : DEFAULT_DIGEST.hourLocal,
    tz: validTz(d.tz) ? d.tz : DEFAULT_DIGEST.tz,
  }
}

/** Injected so tests run without the model, FCM, SMTP or a messenger account. */
export interface DigestDeps {
  summarize: (args: DigestPromptArgs) => Promise<string>
  push: (uids: string[], message: PushMessage) => Promise<unknown>
  mail: Mailer | null
  messenger: (phone: string) => MessengerProvider
  emailOf: (uid: string) => Promise<string | null>
}

export function defaultDigestDeps(): DigestDeps {
  return {
    // Shares the Mac mini with the memo model and speech-to-text.
    summarize: (args) => withModelLock(() => generateSummary(args)),
    push: pushToUsers,
    mail: mailerFromEnv(),
    messenger: (phone) => providerFor(phone),
    emailOf: async (uid) => (await getAuth().getUser(uid).catch(() => null))?.email ?? null,
  }
}

interface Period {
  kind: DigestSpan
  /** Part of the digest's id: the day, or the month for a recap. */
  key: string
  start: Date
  end: Date
  /** "10월 4일 토요일", "9월 28일~10월 4일", "9월". */
  label: string
  notice: (name: string) => string
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function periods(clock: LocalClock, tz: string, now: Date, s: DigestSettings, plans: PlansDoc, tier: ReturnType<typeof tierOf>): Period[] {
  const ent = plans[tier]
  const weeklyIncluded = ent?.weekly === true
  const out: Period[] = []
  const today = localDayStart(tz, clock.year, clock.month, clock.day)
  if (s.cadence === 'daily' || !weeklyIncluded) {
    out.push({
      kind: 'daily',
      key: clock.dayKey,
      start: today,
      end: now,
      label: `${clock.month}월 ${clock.day}일 ${WEEKDAYS[clock.weekday]}요일`,
      notice: (name) => `${name}님의 오늘 하루 요약이 도착했어요`,
    })
  }
  if (weeklyIncluded && clock.weekday === 0) {
    const start = localDayStart(tz, clock.year, clock.month, clock.day - 6)
    const from = localClock(tz, start)
    out.push({
      kind: 'weekly',
      key: clock.dayKey,
      start,
      end: now,
      label: `${from.month}월 ${from.day}일~${clock.month}월 ${clock.day}일`,
      notice: (name) => `${name}님의 이번 주 하이라이트가 도착했어요`,
    })
  }
  if (ent?.recap === true && clock.day === 1) {
    const start = localDayStart(tz, clock.year, clock.month - 1, 1)
    const from = localClock(tz, start)
    out.push({
      kind: 'monthly',
      key: `${from.year}${String(from.month).padStart(2, '0')}`,
      start,
      end: today,
      label: `${from.month}월`,
      notice: (name) => `${name}님의 ${from.month}월 앨범이 도착했어요`,
    })
  }
  return out
}

const PLAIN: Record<DigestSpan, (n: number) => string> = {
  daily: (n) => `오늘 사진 ${n}장을 남기셨어요.`,
  weekly: (n) => `이번 주에 사진 ${n}장을 남기셨어요.`,
  monthly: (n) => `지난달에 사진 ${n}장을 남기셨어요.`,
}

/** "어머니가 하트 1개, 음성 답장 1개를 남기셨어요" (empty when there were none). */
export function repliesLine(name: string, hearts: number, voices: number): string {
  const parts = [hearts ? `하트 ${hearts}개` : '', voices ? `음성 답장 ${voices}개` : ''].filter(Boolean)
  return parts.length ? `${name}님이 ${parts.join(', ')}를 남기셨어요` : ''
}

export interface DigestRun { digests: number; deliveries: number; checkins: number }

const summaryAttempts = new Map<string, number>()

/** Test hook. */
export function resetDigestState() {
  summaryAttempts.clear()
}

/** One pass over every parent with family. Returns null while the flag is off. */
export async function runDigests(now: Date = new Date(), deps: DigestDeps = defaultDigestDeps()): Promise<DigestRun | null> {
  const plans = await getPlans()
  if (plans?.flags?.digest !== true) return null
  const db = getFirestore()

  const family = new Map<string, string[]>()
  const members = await db.collection('memberships').where('status', '==', 'active').get()
  for (const m of members.docs) {
    const patientUid = m.get('patientUid') as string
    const caregiverUid = m.get('caregiverUid') as string
    if (!patientUid || !caregiverUid || caregiverUid === patientUid) continue
    family.set(patientUid, [...(family.get(patientUid) ?? []), caregiverUid])
  }

  const run: DigestRun = { digests: 0, deliveries: 0, checkins: 0 }
  for (const [patientUid, recipients] of family) {
    try {
      const user = (await db.doc(`users/${patientUid}`).get()).data()
      if (!user) continue
      const s = digestSettings(user)
      const clock = localClock(s.tz, now)
      if (clock.hour < s.hourLocal) continue
      const tier = tierOf(user)
      const name = (user.patientName as string) || '부모님'

      for (const period of periods(clock, s.tz, now, s, plans, tier)) {
        const waitForModel = clock.hour < Math.min(23, s.hourLocal + WAIT_FOR_MODEL_HOURS)
        const one = await ensureDigest({ patientUid, name, period, recipients, plans, tier, waitForModel, tz: s.tz }, deps)
        run.digests += one.created ? 1 : 0
        run.deliveries += one.deliveries
      }
      if (plans[tier]?.checkin === true) {
        const told = await checkIn({
          patientUid,
          patientName: name,
          dayKey: clock.dayKey,
          dayStart: localDayStart(s.tz, clock.year, clock.month, clock.day),
          now,
          recipients,
          push: deps.push,
        })
        run.checkins += told ? 1 : 0
      }
    } catch (err) {
      logger.error('[digest] patient failed; continuing with the rest', { patientUid, err: String(err) })
    }
  }
  if (run.digests || run.deliveries || run.checkins) logger.info('[digest] done', { ...run })
  return run
}

interface EnsureArgs {
  patientUid: string
  name: string
  period: Period
  recipients: string[]
  plans: PlansDoc
  tier: ReturnType<typeof tierOf>
  waitForModel: boolean
  tz: string
}

async function ensureDigest(a: EnsureArgs, deps: DigestDeps): Promise<{ created: boolean; deliveries: number }> {
  const db = getFirestore()
  const id = `${a.patientUid}_${a.period.kind}_${a.period.key}`
  const ref = db.doc(`digests/${id}`)
  let snap = await ref.get()
  let created = false

  if (!snap.exists) {
    const built = await buildDigest(a, deps)
    if (!built) return { created: false, deliveries: 0 }
    try {
      await ref.create(built)
      created = true
      const day = new Date().toISOString().slice(0, 10)
      await db.collection('admin_daily').doc(day).set({ date: day, digests: FieldValue.increment(1) }, { merge: true })
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err // 6 = already exists
    }
    snap = await ref.get()
  }

  const deliveries = await deliver(ref, snap.data()!, a, deps)
  return { created, deliveries }
}

/** The digest's content, or null when there is nothing to send yet. */
async function buildDigest(a: EnsureArgs, deps: DigestDeps): Promise<Record<string, unknown> | null> {
  const db = getFirestore()
  const { patientUid, period } = a
  const id = `${patientUid}_${period.kind}_${period.key}`
  const memoSnap = await db.collection('memos')
    .where('patientUid', '==', patientUid)
    .where('takenAt', '>=', Timestamp.fromDate(period.start))
    .where('takenAt', '<', Timestamp.fromDate(period.end))
    .orderBy('takenAt', 'desc')
    .get()
  const memos = memoSnap.docs.filter((m) => m.get('status') !== 'error').reverse()
  if (memos.length === 0) return null

  // The parent's own replies in the period.
  const replySnap = await db.collection('reactions')
    .where('patientUid', '==', patientUid)
    .where('createdAt', '>=', Timestamp.fromDate(period.start))
    .orderBy('createdAt', 'desc')
    .get()
  const own = replySnap.docs.filter((r) => r.get('actorUid') === patientUid && (r.get('createdAt') as Timestamp).toMillis() < period.end.getTime())
  const hearts = own.filter((r) => r.get('kind') === 'heart').length
  const voices = own.filter((r) => r.get('kind') === 'voice' && r.get('status') === 'ready')
  // Hearing the parent's voice is part of the plan; so is reading what they said.
  const transcripts = a.plans[a.tier]?.voiceReplies === true
    ? voices.map((r) => r.get('transcript') as string | undefined).filter((t): t is string => !!t).reverse()
    : []

  const lines = memos.map((m) => memoLine(m, period.kind, a.tz))
  let summary: string
  let summarySource: 'local-llm' | 'plain'
  try {
    summary = await deps.summarize({ span: period.kind, lines })
    summarySource = 'local-llm'
    summaryAttempts.delete(id)
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      if (a.waitForModel) {
        logger.warn('[digest] model unavailable; will try again', { id })
        return null
      }
    } else if (err instanceof LlmGenerationError) {
      const attempt = (summaryAttempts.get(id) ?? 0) + 1
      summaryAttempts.set(id, attempt)
      if (attempt < MAX_SUMMARY_ATTEMPTS) {
        logger.warn('[digest] summary failed; will try again', { id, attempt, err: err.message })
        return null
      }
    } else {
      throw err
    }
    logger.warn('[digest] sending without a model summary', { id })
    summary = PLAIN[period.kind](memos.length)
    summarySource = 'plain'
    summaryAttempts.delete(id)
  }

  return {
    patientUid,
    patientName: a.name,
    kind: period.kind,
    periodStart: Timestamp.fromDate(period.start),
    periodEnd: Timestamp.fromDate(period.end),
    label: period.label,
    memoIds: memos.slice(-MAX_MEMO_IDS).map((m) => m.id),
    photoCount: memos.length,
    summary,
    summarySource,
    replies: { hearts, voices: voices.length, transcripts },
    status: 'ready',
    sentVia: [],
    delivered: {},
    createdAt: FieldValue.serverTimestamp(),
  }
}

/** "09:40 산책 · 나무가 우거진 공원 산책길 · 서초동" (weekly and monthly lines start with the date). */
function memoLine(m: FirebaseFirestore.QueryDocumentSnapshot, kind: DigestSpan, tz: string): string {
  const takenAt = (m.get('takenAt') as Timestamp).toDate()
  const local = new Date(takenAt.getTime() + tzOffsetMin(tz, takenAt) * 60_000).toISOString()
  const when = kind === 'daily' ? local.slice(11, 16) : `${Number(local.slice(5, 7))}월 ${Number(local.slice(8, 10))}일 ${local.slice(11, 16)}`
  // A photo kept without a memo still says when, what kind and where.
  const text = m.get('memoSource') === 'stored-only' ? '' : ((m.get('memo') as string) || '')
  const place = areaOf((m.get('place') as string) || '')
  return [`${when} ${(m.get('activity') as string) || '기타'}`, text, place].filter(Boolean).join(' · ')
}

/** Send the digest to every family member who hasn't had it. Returns how many were sent to. */
async function deliver(ref: FirebaseFirestore.DocumentReference, digest: FirebaseFirestore.DocumentData, a: EnsureArgs, deps: DigestDeps): Promise<number> {
  const db = getFirestore()
  const delivered = (digest.delivered ?? {}) as Record<string, string[]>
  const pending = a.recipients.filter((uid) => !delivered[uid])
  if (pending.length === 0) return 0

  const notice = a.period.notice(a.name)
  const path = `digest/${ref.id}`
  const link = appLink(path)
  const messengerIncluded = a.plans[a.tier]?.messenger === true || a.plans.flags?.messengerFree === true
  const replies = digest.replies as { hearts: number; voices: number }

  for (const uid of pending) {
    const via: string[] = []
    try {
      await db.doc(`notifications/digest_${ref.id}_${uid}`).create({
        recipientUid: uid,
        patientUid: a.patientUid,
        actorUid: 'worker',
        type: 'digest.ready',
        message: notice,
        digestId: ref.id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })
      via.push('inapp')
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err // 6 = already exists
    }
    if (await deps.push([uid], { title: '오늘하루', body: notice, data: { type: 'digest.ready', patientUid: a.patientUid, digestId: ref.id }, path })) via.push('push')

    const channels = ((await db.doc(`users/${uid}`).get()).data()?.channels ?? {}) as { email?: boolean; messenger?: boolean }
    if (deps.mail && channels.email !== false) {
      const to = await deps.emailOf(uid)
      const sent = to && await deps.mail.send({
        to,
        subject: `[오늘하루] ${a.name}님의 ${a.period.label}`,
        text: [
          digest.summary as string,
          '',
          [`사진 ${digest.photoCount}장`, repliesLine(a.name, replies.hearts, replies.voices)].filter(Boolean).join(' · '),
          '',
          `자세히 보기: ${link}`,
          '',
          '오늘하루 · Daylie AI',
        ].join('\n'),
      })
      if (sent) {
        via.push('email')
        await countSend('email')
      }
    }
    if (messengerIncluded && channels.messenger === true) {
      const phone = (await contactDoc(uid).get()).data()?.phone as string | undefined
      if (phone) {
        const res = await deps.messenger(phone).send(phone, 'digest', { name: a.name, date: a.period.label, link })
        if (res.ok) {
          via.push(res.provider)
          await countSend(res.provider, res.cost)
        }
      }
    }

    await ref.update({ [`delivered.${uid}`]: via, ...(via.length ? { sentVia: FieldValue.arrayUnion(...via) } : {}) })
  }
  logger.info('[digest] delivered', { digestId: ref.id, recipients: pending.length })
  return pending.length
}

/** Dashboard counters: how many went out by each paid-or-free channel, and a rough cost. */
async function countSend(channel: string, cost?: { amount: number; currency: string }) {
  const day = new Date().toISOString().slice(0, 10)
  const inc = FieldValue.increment
  await getFirestore().collection('admin_daily').doc(day).set({
    date: day,
    sends: { [channel]: { count: inc(1), ...(cost ? { [`cost${cost.currency}`]: inc(cost.amount) } : {}) } },
  }, { merge: true }).catch((err) => logger.warn('[digest] counter failed', { err: String(err) }))
}

// ────────────────────────────────────────────────────────────────────────────
// Request: setDigest
// ────────────────────────────────────────────────────────────────────────────

/** When and how often a parent's digest goes out. Family managers (or the
 *  account's own owner) only; weekly needs a plan that includes it. */
export async function setDigest(caller: Caller, data: Record<string, unknown>): Promise<{ digest: DigestSettings }> {
  const patientUid = typeof data?.patientUid === 'string' ? data.patientUid : ''
  if (!caller.uid || !patientUid) throw new HttpsError('invalid-argument', 'patientUid required')
  if (!(await isOwnerOrAdminCaregiver(caller.uid, patientUid))) throw new HttpsError('permission-denied', 'not allowed to change this')

  const db = getFirestore()
  const userRef = db.doc(`users/${patientUid}`)
  const digest = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef)
    if (!snap.exists) throw new HttpsError('not-found', 'no such account')
    const next = digestSettings(snap.data())
    const changes: Partial<DigestSettings> = {}
    if (data.cadence !== undefined) {
      if (data.cadence !== 'daily' && data.cadence !== 'weekly') throw new HttpsError('invalid-argument', 'cadence must be daily or weekly')
      if (data.cadence === 'weekly' && (await getPlans())?.[tierOf(snap.data())]?.weekly !== true) {
        throw new HttpsError('failed-precondition', 'the plan does not include a weekly digest')
      }
      changes.cadence = data.cadence
    }
    if (data.hourLocal !== undefined) {
      if (!Number.isInteger(data.hourLocal) || (data.hourLocal as number) < 0 || (data.hourLocal as number) > 23) {
        throw new HttpsError('invalid-argument', 'hourLocal must be 0-23')
      }
      changes.hourLocal = data.hourLocal as number
    }
    if (data.tz !== undefined) {
      if (!validTz(data.tz)) throw new HttpsError('invalid-argument', 'unknown time zone')
      changes.tz = data.tz
    }
    if (Object.keys(changes).length === 0) throw new HttpsError('invalid-argument', 'nothing to change')
    Object.assign(next, changes)
    tx.update(userRef, { digest: next })
    tx.set(db.collection('auditLogs').doc(), {
      patientUid,
      actorUid: caller.uid,
      action: 'digest.update',
      details: changes,
      timestamp: FieldValue.serverTimestamp(),
    })
    return next
  })
  return { digest }
}

/** Check every ten minutes while the worker is up; one pass at a time. */
export function startDigests(): () => void {
  const deps = defaultDigestDeps()
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runDigests(new Date(), deps)
    } catch (err) {
      logger.error('[digest] run failed', { err: String(err) })
    } finally {
      running = false
    }
  }
  const first = setTimeout(() => void tick(), FIRST_TICK_MS)
  const timer = setInterval(() => void tick(), TICK_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
