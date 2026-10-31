// A family member's own photo diary (pages/MyDay.tsx, and their 과거):
// their photos, their parents' and the ones they sent, on one timeline.

import type { SentEntry } from '../pages/Today'
import type { Memo } from '../types'
import { lang } from './lang'

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


/** Two or more photos of one parent that aren't new, as one row. */
export interface ParentGroup { kind: 'parentGroup'; at: number; uid: string; items: ParentMemo[] }

/** A diary line after collapsing: one of the entries above, or a parent's stack of photos. */
export type DiaryRow<E extends { kind: string; at: number }> = E | ParentGroup

/** A parent's photo that reached the family after they last looked at their day. */
export function isNewParentPhoto(memo: Memo, seenAt: number): boolean {
  return (memo.createdAt?.toMillis?.() ?? memo.takenAt.toDate().getTime()) > seenAt
}

/**
 * Keeps a day quiet: each parent's photos that aren't new become one
 * `parentGroup`, where the first of them was, even with other rows between
 * them (at = the first's time). A new photo stays its own row, and so does a
 * parent's only old one. Order is otherwise kept.
 */
export function collapseParents<E extends { kind: string; at: number; item?: unknown }>(entries: E[], isNew: (item: ParentMemo) => boolean = () => false): DiaryRow<E>[] {
  const stacks = new Map<string, ParentMemo[]>()
  for (const e of entries) {
    if (e.kind !== 'parent' || isNew(e.item as ParentMemo)) continue
    const item = e.item as ParentMemo
    stacks.set(item.memo.patientUid, [...(stacks.get(item.memo.patientUid) ?? []), item])
  }
  const out: DiaryRow<E>[] = []
  const placed = new Set<string>()
  for (const e of entries) {
    const item = e.item as ParentMemo
    const stack = e.kind === 'parent' && !isNew(item) ? stacks.get(item.memo.patientUid) : undefined
    if (!stack || stack.length < 2) { out.push(e); continue }
    const uid = item.memo.patientUid
    if (placed.has(uid)) continue
    placed.add(uid)
    out.push({ kind: 'parentGroup', at: e.at, uid, items: stack })
  }
  return out
}

/** `내 사진 3장 · 엄마 2장 · 아빠 1장`: one's own count, then each parent with photos today. */
export function myDayCaption(mine: number, parents: ParentMemo[]): string {
  const byName = new Map<string, number>()
  for (const p of parents) byName.set(p.name, (byName.get(p.name) ?? 0) + 1)
  if (lang === 'en') {
    return [`${mine} photo${mine === 1 ? '' : 's'} of mine`, ...[...byName].map(([name, n]) => `${name} ${n}`)].join(' · ')
  }
  return [`내 사진 ${mine}장`, ...[...byName].map(([name, n]) => `${name} ${n}장`)].join(' · ')
}
