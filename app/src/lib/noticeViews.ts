import type { AppNotification } from '../types'

/** What the person has on screen, as far as notices are concerned. */
export type NoticeView =
  | { kind: 'memo'; patientUid: string; memoId: string }
  | { kind: 'home' | 'today'; patientUid: string }
  /** The simple edition's parent's day: today's photos on screen. */
  | { kind: 'day'; patientUid: string }
  | { kind: 'digest'; digestId: string }
  | { kind: 'other' }

/**
 * The unread notices that looking at `view` counts as having seen, so the
 * badge on the app icon goes down without a visit to 알림:
 * a photo (its new-photo notice and the parent's replies on it), a parent's
 * home (their answers to photos you sent, listed there), a parent's 사진 tab
 * (the evening photo count), a parent's day (its photos and their count, and
 * their answers) and a digest.
 */
export function noticesSeen(view: NoticeView, unread: AppNotification[]): string[] {
  const seen = (n: AppNotification): boolean => {
    switch (view.kind) {
      case 'memo':
        return n.patientUid === view.patientUid && n.memoId === view.memoId && (n.type === 'photo.new' || n.type.startsWith('reaction.'))
      case 'home':
        return n.patientUid === view.patientUid && n.type.startsWith('familyPhoto.')
      case 'day':
        return n.patientUid === view.patientUid && (n.type === 'photo.new' || n.type === 'daily.photos' || n.type.startsWith('familyPhoto.'))
      case 'today':
        return n.patientUid === view.patientUid && n.type.startsWith('daily.')
      case 'digest':
        return n.digestId === view.digestId
      default:
        return false
    }
  }
  return unread.filter((n) => !n.read && seen(n)).map((n) => n.id)
}
