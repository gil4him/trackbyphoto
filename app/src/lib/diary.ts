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


/** Two or more photos of one parent with nothing between them, as one row (A14.3). */
export interface ParentGroup { kind: 'parentGroup'; at: number; uid: string; items: ParentMemo[] }

/** A diary line after collapsing: one of the entries above, or a parent's run of photos. */
export type DiaryRow<E extends { kind: string; at: number }> = E | ParentGroup

/**
 * Collapse runs of the same parent's photos: 2+ `parent` entries of one parent
 * with no other row between them become one `parentGroup` (at = the first's
 * time). Anything else in between — one's own photo, a sent one, the other
 * parent — ends the run. Order is kept.
 */
export function collapseParents<E extends { kind: string; at: number; item?: unknown }>(entries: E[]): DiaryRow<E>[] {
  const out: DiaryRow<E>[] = []
  let run: { uid: string; at: number; items: ParentMemo[]; first: E } | null = null
  const flush = () => {
    if (!run) return
    out.push(run.items.length >= 2 ? { kind: 'parentGroup', at: run.at, uid: run.uid, items: run.items } : run.first)
    run = null
  }
  for (const e of entries) {
    if (e.kind === 'parent') {
      const item = e.item as ParentMemo
      const uid = item.memo.patientUid
      if (run && run.uid === uid) { run.items.push(item); continue }
      flush()
      run = { uid, at: e.at, items: [item], first: e }
      continue
    }
    flush()
    out.push(e)
  }
  flush()
  return out
}

/** `내 사진 3장 · 엄마 2장 · 아빠 1장`: one's own count, then each parent with photos today. */
export function myDayCaption(mine: number, parents: ParentMemo[]): string {
  const byName = new Map<string, number>()
  for (const p of parents) byName.set(p.name, (byName.get(p.name) ?? 0) + 1)
  return [`내 사진 ${mine}장`, ...[...byName].map(([name, n]) => `${name} ${n}장`)].join(' · ')
}
