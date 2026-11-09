// A photo that reached the server long after it was taken (it waited on the
// parent's phone, e.g. the app was closed before it was sent). It is filed
// under the day it was taken, so its page says when it arrived (owner, 2026-11-09).

import { tr } from './lang'
import { fmtDate } from '../util'

/** Arriving this much later than the shot counts as late. */
export const LATE_MS = 3 * 60 * 60_000

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "11월 3일 (화)에 찍은 사진이 오늘 도착했어요", or null when it came in time. */
export function lateArrivalLine(takenAtMs: number, createdAtMs: number | null | undefined, now = new Date()): string | null {
  if (createdAtMs == null || createdAtMs - takenAtMs < LATE_MS) return null
  const taken = new Date(takenAtMs)
  const arrived = new Date(createdAtMs)
  if (sameDay(taken, arrived)) return null
  if (sameDay(arrived, now)) return tr(`${fmtDate(taken)}에 찍은 사진이 오늘 도착했어요`, `Taken ${fmtDate(taken)} · arrived today`)
  return tr(`${fmtDate(taken)}에 찍은 사진이 ${fmtDate(arrived)}에 도착했어요`, `Taken ${fmtDate(taken)} · arrived ${fmtDate(arrived)}`)
}
