// A family member's own photo diary (pages/MyDay.tsx, and their 과거):
// their photos, their parents' and the ones they sent, on one timeline.

import type { SentEntry } from '../pages/Today'
import type { Memo } from '../types'

/** A parent's photo shown in a family member's own diary. */
export interface ParentMemo { memo: Memo; name: string; color: string }

/** One line of the day: one's own photo, a parent's, or one sent to a parent. */
export type DiaryEntry =
  | { kind: 'mine'; at: number; memo: Memo }
  | { kind: 'parent'; at: number; item: ParentMemo }
  | { kind: 'sent'; at: number; item: SentEntry }

/** One's own photos, the parents' and what one sent, newest first. */
export function diaryEntries(own: Memo[], parents: ParentMemo[], sent: SentEntry[]): DiaryEntry[] {
  return [
    ...own.map((memo) => ({ kind: 'mine' as const, at: memo.takenAt.toDate().getTime(), memo })),
    ...parents.map((item) => ({ kind: 'parent' as const, at: item.memo.takenAt.toDate().getTime(), item })),
    ...sent.filter((s) => !!s.photo.photoUrl).map((item) => ({ kind: 'sent' as const, at: item.photo.createdAtMs, item })),
  ].sort((a, b) => b.at - a.at)
}

