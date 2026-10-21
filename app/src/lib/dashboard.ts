import type { AppNotification, Memo } from '../types'

// The family dashboard (docs/DAYLIE_V3_UI_FIX.md A10): what Home needs to
// know about each connected parent for their card.

/** One parent as the family's own home lists them. */
export interface ParentSummary {
  uid: string
  name: string
  /** The parent's latest memos, newest first (useParentsMemos). */
  memos: Memo[]
  /** The newest unread family event about this parent, if any. */
  unread?: AppNotification
}

/** When the parent was last heard from — the newest photo or notice — for
 *  putting the cards newest first. */
export function latestActivity(p: Pick<ParentSummary, 'memos' | 'unread'>): number {
  const photo = p.memos[0]?.takenAt?.toMillis?.() ?? 0
  const news = p.unread?.createdAt?.toMillis?.() ?? 0
  return Math.max(photo, news)
}
