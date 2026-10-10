/**
 * The simple edition's one notice a day (docs/Daylie-v3-Simple-Core.md §3):
 * at the parent's evening hour each family member is told how many photos
 * the parent took today — "오늘 엄마님의 사진 3장" — or, on a day without
 * any, "오늘 아직 엄마님의 사진이 없어요". In-app notice plus push, once per
 * person per day. Started only by the simple worker (config.edition()); it
 * replaces the per-photo notice there and needs neither the digest flag nor
 * a plan with check-ins.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { localClock, localDayStart } from '../zoned.js'
import { digestSettings } from './digest.js'
import { pushToUsers, type PushMessage } from './push.js'

const TICK_MS = 10 * 60 * 1000
const FIRST_TICK_MS = 2 * 60 * 1000

export interface DailyNoticeDeps {
  push: (uids: string[], message: PushMessage) => Promise<unknown>
}

export function dailyNoticeText(name: string, photos: number): string {
  // "부모님" (no name on file) already ends in 님.
  const whose = name.endsWith('님') ? `${name}의` : `${name}님의`
  return photos > 0 ? `오늘 ${whose} 사진 ${photos}장` : `오늘 아직 ${whose} 사진이 없어요`
}

/** One pass over every parent with family. Returns how many parents' families were told. */
export async function runDailyNotices(now: Date = new Date(), deps: DailyNoticeDeps = { push: pushToUsers }): Promise<number> {
  const db = getFirestore()

  const family = new Map<string, string[]>()
  const members = await db.collection('memberships').where('status', '==', 'active').get()
  for (const m of members.docs) {
    const patientUid = m.get('patientUid') as string
    const caregiverUid = m.get('caregiverUid') as string
    if (!patientUid || !caregiverUid || caregiverUid === patientUid) continue
    family.set(patientUid, [...(family.get(patientUid) ?? []), caregiverUid])
  }

  let parents = 0
  for (const [patientUid, recipients] of family) {
    try {
      const user = (await db.doc(`users/${patientUid}`).get()).data()
      if (!user) continue
      const s = digestSettings(user)
      const clock = localClock(s.tz, now)
      if (clock.hour < s.hourLocal) continue
      const dayStart = localDayStart(s.tz, clock.year, clock.month, clock.day)

      const today = await db.collection('memos')
        .where('patientUid', '==', patientUid)
        .where('takenAt', '>=', Timestamp.fromDate(dayStart))
        .where('takenAt', '<=', Timestamp.fromDate(now))
        .select('status')
        .get()
      const photos = today.docs.filter((d) => d.get('status') !== 'error').length
      const message = dailyNoticeText((user.patientName as string) || '부모님', photos)

      const told: string[] = []
      for (const recipientUid of recipients) {
        try {
          // The id makes it once a day per person, however often this runs.
          await db.doc(`notifications/daily_${patientUid}_${clock.dayKey}_${recipientUid}`).create({
            recipientUid,
            patientUid,
            actorUid: 'worker',
            type: photos > 0 ? 'daily.photos' : 'daily.no_photo',
            message,
            photoCount: photos,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          })
          told.push(recipientUid)
        } catch (err) {
          if ((err as { code?: number }).code !== 6) throw err // 6 = already exists
        }
      }
      if (told.length) {
        // No memoId: opening it lands on the 사진 timeline.
        await deps.push(told, { title: '오늘하루', body: message, data: { type: 'daily.photos', patientUid } })
        logger.info('[daily] notice sent', { patientUid, photos, told: told.length })
        parents++
      }
    } catch (err) {
      logger.error('[daily] patient failed; continuing with the rest', { patientUid, err: String(err) })
    }
  }
  return parents
}

/** Check every ten minutes while the worker is up; one pass at a time. */
export function startDailyNotices(): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runDailyNotices()
    } catch (err) {
      logger.error('[daily] run failed', { err: String(err) })
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
