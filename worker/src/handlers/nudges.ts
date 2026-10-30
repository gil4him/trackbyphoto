/**
 * Two reminders the simple edition sends on its own (owner decision,
 * 2026-10-29; wording owner-approved, changing it needs the owner's approval):
 *
 *   absence.parent / absence.family — a parent's linked phone has not opened
 *     Daylie for a day (no reportDevice in 24 h and no photo in 24 h). The
 *     parent's phone gets one push asking for today's photo, and every family
 *     member gets a notice and a push saying the parent hasn't opened the app.
 *     At most once per 24 h while the absence lasts; it ends by itself when
 *     the phone opens again. Behind the `absenceNudges` flag.
 *
 *   pairing.pending / invite.pending — a parent's connect link, or a family
 *     invite, still unaccepted 12 h after it was made (both live 24 h). The
 *     person who made it is told once, in 알림 and by push. Behind the
 *     `pendingLinkNudges` flag.
 *
 * Both only between 09:00 and 21:00 in the parent's zone (digest tz), which
 * is the zone the family's evening notice already assumes for them.
 *
 * A phone reports an open through reportDevice once an hour while in use from
 * 1.0.5; older phones report once a day, so for them a report is only stale
 * after 48 h. A phone that never reported (1.0.3 and older) is unknown and is
 * never nudged. Pairings and invites never flip to expired on their own, so
 * the queries bound createdAt on both sides and check expiresAt in code; a
 * link made just after 09:00 reaches its 12 h mark after 21:00 and runs out
 * before the next morning, so it gets no reminder — accepted.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { flagOn } from '../plans.js'
import { compareVersions } from '../storeVersions.js'
import { resolveGeoLang } from '../travel.js'
import { localClock } from '../zoned.js'
import { addressed } from './adminCheckIn.js'
import { digestSettings } from './digest.js'
import { elderName, familyNotice, hashCode } from './pairing.js'
import { openPath, pushToElder, pushToUsers, type PushMessage } from './push.js'

const HOUR_MS = 3600_000
/** No open for this long → absent (phones that report hourly). */
export const ABSENT_MS = 24 * HOUR_MS
/** Phones that report once a day: a report this old means no open for a day. */
export const ABSENT_THROTTLED_MS = 48 * HOUR_MS
/** The first app version that reports an open every hour. */
export const FRESH_REPORT_VERSION = '1.0.5'
/** How often the absence nudge may repeat while the absence lasts. */
export const NUDGE_EVERY_MS = 24 * HOUR_MS
/** A link or invite unaccepted this long is reminded about. */
export const PENDING_AFTER_MS = 12 * HOUR_MS
/** Connect links and invites both live this long. */
export const LINK_TTL_MS = 24 * HOUR_MS
export const DAY_FROM = 9
export const DAY_TO = 21

const TICK_MS = 10 * 60 * 1000
const FIRST_TICK_MS = 2 * 60 * 1000
const ABSENCE_EVERY_MS = 60 * 60 * 1000

export type Lang = 'ko' | 'en'

/** The owner-approved wording (2026-10-29). */
export const NUDGE_TEXT: Record<Lang, {
  absenceParent: string
  absenceFamily: (name: string) => string
  pairingPending: (name: string) => string
  invitePending: string
}> = {
  ko: {
    absenceParent: '가족이 오늘 사진을 기다리고 있어요. 눌러서 사진 한 장 남겨 주세요',
    absenceFamily: (name) => `${name} 휴대폰에서 하루 넘게 Daylie를 열지 않았어요. 전화 한 통 드려 보시는 건 어때요?`,
    pairingPending: (name) => `${name} 휴대폰이 아직 연결되지 않았어요. 전화로 도와드리거나 설정에서 링크를 다시 보내 주세요`,
    invitePending: '보내신 가족 초대를 아직 아무도 받지 않았어요. 초대 코드는 24시간만 쓸 수 있으니 한 번 더 알려 주세요',
  },
  en: {
    absenceParent: "Your family is waiting for today's photo. Tap to take one.",
    absenceFamily: (name) => `${name} hasn't opened Daylie in over a day. How about a quick call?`,
    pairingPending: (name) => `${name}'s phone isn't connected yet. Help them over the phone, or send the link again from Settings.`,
    invitePending: 'Nobody has accepted your family invite yet. The code works for 24 hours, so you may want to remind them.',
  },
}

/** 09:00 ≤ local hour < 21:00. */
export function inDaytime(tz: string, now: Date): boolean {
  const { hour } = localClock(tz, now)
  return hour >= DAY_FROM && hour < DAY_TO
}

/** The parent's name as the recipient's language says it (엄마 / 영희님; English drops 님). */
export async function nameFor(lang: Lang, patientUid: string): Promise<string> {
  const raw = await elderName(patientUid)
  if (lang !== 'en') return addressed(raw)
  // No name on file reads as 부모님; in English that is "your parent".
  return raw === '부모님' ? 'your parent' : raw.replace(/\s*님$/, '') || 'your parent'
}

const langOf = async (uid: string): Promise<Lang> => ((await resolveGeoLang(uid)) === 'en' ? 'en' : 'ko')

export interface NudgeDeps {
  pushFamily: (uids: string[], message: PushMessage) => Promise<unknown>
  pushElder: (patientUid: string, message: PushMessage) => Promise<number>
}
const defaultDeps: NudgeDeps = { pushFamily: pushToUsers, pushElder: pushToElder }

/** Write a notice once (fixed id); false when it was already there. */
async function noticeOnce(id: string, recipientUid: string, patientUid: string, type: string, message: string): Promise<boolean> {
  try {
    await getFirestore().doc(`notifications/${id}`).create(familyNotice(recipientUid, patientUid, 'worker', type, message))
    return true
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false // already exists
    throw err
  }
}

/** Notices in each recipient's language, then one push per language. */
async function tellFamily(
  recipients: string[],
  patientUid: string,
  type: string,
  idFor: (uid: string) => string,
  body: (lang: Lang, name: string) => string,
  push: NudgeDeps['pushFamily'],
): Promise<number> {
  const byLang = new Map<Lang, { uids: string[]; message: string }>()
  for (const uid of recipients) {
    const lang = await langOf(uid)
    let group = byLang.get(lang)
    if (!group) {
      group = { uids: [], message: body(lang, await nameFor(lang, patientUid)) }
      byLang.set(lang, group)
    }
    if (await noticeOnce(idFor(uid), uid, patientUid, type, group.message)) group.uids.push(uid)
  }
  let told = 0
  for (const { uids, message } of byLang.values()) {
    if (!uids.length) continue
    // Best-effort, like every family push: the 알림 list already has it.
    await push(uids, { title: 'Daylie', body: message, data: { type, patientUid }, path: openPath.home(patientUid) }).catch(() => 0)
    told += uids.length
  }
  return told
}

type Presence = 'active' | 'absent' | 'unknown'

/** What the parent's active phones say about the last open. */
export function presenceOf(devices: Array<{ app?: { version?: unknown; reportedAt?: Timestamp } }>, now: Date): Presence {
  let known = false
  for (const d of devices) {
    const at = d.app?.reportedAt
    if (!at || typeof at.toMillis !== 'function') continue
    known = true
    const version = typeof d.app?.version === 'string' ? d.app.version : '0'
    const threshold = compareVersions(version, FRESH_REPORT_VERSION) >= 0 ? ABSENT_MS : ABSENT_THROTTLED_MS
    if (now.getTime() - at.toMillis() < threshold) return 'active'
  }
  return known ? 'absent' : 'unknown'
}

/** One pass over every parent with family. Returns how many parents were nudged. */
export async function runAbsenceNudges(now: Date = new Date(), deps: NudgeDeps = defaultDeps): Promise<number> {
  if (!(await flagOn('absenceNudges'))) return 0
  const db = getFirestore()

  const family = new Map<string, string[]>()
  const members = await db.collection('memberships').where('status', '==', 'active').get()
  for (const m of members.docs) {
    const patientUid = m.get('patientUid') as string
    const caregiverUid = m.get('caregiverUid') as string
    if (!patientUid || !caregiverUid || caregiverUid === patientUid) continue
    family.set(patientUid, [...(family.get(patientUid) ?? []), caregiverUid])
  }

  let nudged = 0
  for (const [patientUid, recipients] of family) {
    try {
      const user = (await db.doc(`users/${patientUid}`).get()).data()
      if (user?.accountType !== 'managed') continue
      const tz = digestSettings(user).tz
      if (!inDaytime(tz, now)) continue

      const devices = await db.collection(`users/${patientUid}/devices`).where('status', '==', 'active').get()
      if (presenceOf(devices.docs.map((d) => d.data()), now) !== 'absent') continue

      // A photo is an open too, whatever the phone reported.
      const recent = await db.collection('memos').where('patientUid', '==', patientUid)
        .where('takenAt', '>=', Timestamp.fromMillis(now.getTime() - ABSENT_MS)).limit(1).get()
      if (!recent.empty) continue

      // Worker-only state (no client can read or write users/{uid}/private).
      const stateRef = db.doc(`users/${patientUid}/private/absenceNudge`)
      const claimed = await db.runTransaction(async (tx) => {
        const last = (await tx.get(stateRef)).get('lastSentAt') as Timestamp | undefined
        if (last && now.getTime() - last.toMillis() < NUDGE_EVERY_MS) return false
        tx.set(stateRef, { lastSentAt: Timestamp.fromDate(now) }, { merge: true })
        return true
      })
      if (!claimed) continue

      const parentLang = await langOf(patientUid)
      // The parent's app has no 알림 list: the push is the whole message, and a tap opens the camera.
      await deps.pushElder(patientUid, { title: 'Daylie', body: NUDGE_TEXT[parentLang].absenceParent, data: { type: 'absence.parent', patientUid } }).catch(() => 0)
      const dayKey = localClock(tz, now).dayKey
      const told = await tellFamily(recipients, patientUid, 'absence.family',
        (uid) => `absence_${patientUid}_${dayKey}_${uid}`,
        (lang, name) => NUDGE_TEXT[lang].absenceFamily(name), deps.pushFamily)
      logger.info('[nudge] absence', { patientUid, told })
      nudged++
    } catch (err) {
      logger.error('[nudge] absence: parent failed; continuing with the rest', { patientUid, err: String(err) })
    }
  }
  return nudged
}

/** Links and invites made between 24 h and 12 h ago, still open, in daytime → one reminder each. */
export async function runPendingReminders(now: Date = new Date(), deps: NudgeDeps = defaultDeps): Promise<{ pairings: number; invites: number }> {
  const out = { pairings: 0, invites: 0 }
  if (!(await flagOn('pendingLinkNudges'))) return out
  const db = getFirestore()
  const ms = now.getTime()
  const window = (q: FirebaseFirestore.Query) => q
    .where('createdAt', '>=', Timestamp.fromMillis(ms - LINK_TTL_MS))
    .where('createdAt', '<=', Timestamp.fromMillis(ms - PENDING_AFTER_MS))

  const tzCache = new Map<string, string | null>()
  const daytimeFor = async (patientUid: string): Promise<boolean> => {
    if (!tzCache.has(patientUid)) {
      const user = (await db.doc(`users/${patientUid}`).get()).data()
      tzCache.set(patientUid, user ? digestSettings(user).tz : null)
    }
    const tz = tzCache.get(patientUid)
    return !!tz && inDaytime(tz, now)
  }
  const stillOpen = (expiresAt: unknown) => expiresAt instanceof Timestamp && expiresAt.toMillis() > ms

  const pairings = await window(db.collection('pairings')).get()
  for (const d of pairings.docs) {
    const p = d.data()
    try {
      const to = p.createdBy as string | undefined
      if (p.status !== 'pending' || p.purpose !== 'onboard' || !to || !stillOpen(p.expiresAt)) continue
      const patientUid = p.patientUid as string
      if (!patientUid || !(await daytimeFor(patientUid))) continue
      const told = await tellFamily([to], patientUid, 'pairing.pending', () => `pairing_pending_${d.id}`,
        (lang, name) => NUDGE_TEXT[lang].pairingPending(name), deps.pushFamily)
      if (told) { out.pairings++; logger.info('[nudge] pairing pending', { patientUid, pairingId: d.id }) }
    } catch (err) {
      logger.error('[nudge] pairing reminder failed; continuing', { pairingId: d.id, err: String(err) })
    }
  }

  const invites = await window(db.collection('invites')).get()
  for (const d of invites.docs) {
    const inv = d.data()
    try {
      const to = inv.createdBy as string | undefined
      const patientUid = inv.patientUid as string | undefined
      if (inv.used === true || !to || !patientUid || to === patientUid || !stillOpen(inv.expiresAt)) continue
      if (!(await daytimeFor(patientUid))) continue
      // The invite's id is its code: never put that in a notice id.
      const told = await tellFamily([to], patientUid, 'invite.pending', () => `invite_pending_${hashCode(d.id).slice(0, 20)}`,
        (lang) => NUDGE_TEXT[lang].invitePending, deps.pushFamily)
      if (told) { out.invites++; logger.info('[nudge] invite pending', { patientUid }) }
    } catch (err) {
      logger.error('[nudge] invite reminder failed; continuing', { err: String(err) })
    }
  }
  return out
}

/** Reminders every ten minutes, the absence sweep once an hour; one pass at a time. */
export function startNudges(): () => void {
  let running = false
  let lastAbsence = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      try {
        await runPendingReminders()
      } catch (err) {
        logger.error('[nudge] reminders failed', { err: String(err) })
      }
      if (Date.now() - lastAbsence >= ABSENCE_EVERY_MS) {
        lastAbsence = Date.now()
        try {
          await runAbsenceNudges()
        } catch (err) {
          logger.error('[nudge] absence run failed', { err: String(err) })
        }
      }
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
