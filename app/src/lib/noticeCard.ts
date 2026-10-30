import { addressed } from './people'
import { tr } from './lang'
import type { AppNotification } from '../types'

/**
 * The floating notice card (owner decision, 2026-10-30). What it shows:
 * identical notices as one, newest first. What it never shows: a "no photo
 * yet" that is no longer true.
 */

export interface NoticeGroup {
  key: string
  ids: string[]
  /** The newest; a merged one points at a photo only if all of them do. */
  notice: AppNotification
  count: number
}

/** `list` newest first (useNotifications). Identical notices become one. */
export function groupNotices(list: AppNotification[]): NoticeGroup[] {
  const groups = new Map<string, NoticeGroup>()
  for (const n of list) {
    const key = `${n.patientUid}|${n.type}|${n.message}`
    const g = groups.get(key)
    if (!g) { groups.set(key, { key, ids: [n.id], notice: n, count: 1 }); continue }
    g.ids.push(n.id)
    g.count += 1
    if (g.notice.memoId !== n.memoId) g.notice = { ...g.notice, memoId: undefined }
  }
  return [...groups.values()]
}

/** The line on the card and in the sheet. */
export function noticeLine(g: NoticeGroup, parentName?: string): string {
  if (g.notice.type === 'photo.new' && g.count > 1) return tr(`새 사진 ${g.count}장`, `${g.count} new photos`)
  return parentName ? addressed(g.notice.message, parentName) : g.notice.message
}

export const isNoPhotoNotice = (type: string) => type === 'daily.no_photo' || type === 'checkin.no_photo'

/**
 * "오늘 아직 사진이 없어요" that stopped being true: its day has ended, or a
 * photo came today. `latestPhotoMs`: the parent's newest photo, 0 if unknown.
 */
export function staleNotices(unread: AppNotification[], now: Date, latestPhotoMs: (patientUid: string) => number): string[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return unread.filter((n) => {
    if (n.read || !isNoPhotoNotice(n.type)) return false
    const made = n.createdAt?.toMillis?.()
    if (made === undefined) return false // the write hasn't reached the server yet
    return made < today || latestPhotoMs(n.patientUid) >= today
  }).map((n) => n.id)
}

/** A sideways drag far enough to throw the card away. */
export const SWIPE_AWAY_PX = 80
export const swipedAway = (dx: number) => Math.abs(dx) >= SWIPE_AWAY_PX
