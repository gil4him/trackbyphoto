// What the screens show from a patient's reactions. No Firebase in here.

import type { Reaction } from '../types'

/** Reactions grouped by memo, oldest first within a memo. */
export function byMemo(reactions: Reaction[]): Map<string, Reaction[]> {
  const map = new Map<string, Reaction[]>()
  for (const r of [...reactions].sort((a, b) => a.createdAtMs - b.createdAtMs)) {
    if (!map.has(r.memoId)) map.set(r.memoId, [])
    map.get(r.memoId)!.push(r)
  }
  return map
}

export type ElderNews =
  | { state: 'none' }
  /** `item` is what the parent is shown; `unreadIds` are stamped read on opening. */
  | { state: 'new' | 'seen'; item: Reaction; unreadIds: string[] }

function sameDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs), b = new Date(bMs)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * The one piece of family news for the parent's home card.
 *   new  — something unread: the newest unread comment, else the newest heart
 *   seen — nothing unread, but family reacted today: show the latest again
 *   none — nothing today
 * One item, no counts, no list: the parent's screen never becomes an inbox.
 */
export function elderNews(reactions: Reaction[], patientUid: string, nowMs: number): ElderNews {
  const family = reactions
    .filter((r) => r.actorUid !== patientUid && (r.kind === 'heart' || r.kind === 'comment'))
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
  const unread = family.filter((r) => !r.readByElderAt)
  if (unread.length > 0) {
    const item = unread.find((r) => r.kind === 'comment') ?? unread[0]
    return { state: 'new', item, unreadIds: unread.map((r) => r.id) }
  }
  const today = family.filter((r) => sameDay(r.createdAtMs, nowMs))
  if (today.length > 0) return { state: 'seen', item: today.find((r) => r.kind === 'comment') ?? today[0], unreadIds: [] }
  return { state: 'none' }
}

/** A family member's own heart on a memo, if any. */
export function myHeart(items: Reaction[], uid: string): Reaction | undefined {
  return items.find((r) => r.kind === 'heart' && r.actorUid === uid)
}
