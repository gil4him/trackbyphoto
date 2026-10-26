// The parent's 내 사진 (A14.7): what each large card says, in plain sentences.

import { subject } from './strings'
import { fmtTime } from '../util'
import type { FamilyPhoto, Memo, Reaction } from '../types'

/** The family's hearts and words on one photo (the parent's own excluded). */
function familyOf(items: Reaction[] | undefined, patientUid: string): Reaction[] {
  return (items ?? []).filter((r) => r.actorUid !== patientUid && r.status === 'ready' && (r.kind === 'heart' || r.kind === 'comment' || r.kind === 'voice'))
}

/**
 * `지민이 ❤️ 하고 글을 남겼어요` / `지민이 ❤️ 보냈어요` / `지민이 글을 남겼어요`;
 * several people: `지민 외 1명이 …`. '' when nobody reacted.
 */
export function reactionSentence(items: Reaction[] | undefined, patientUid: string): string {
  const fam = familyOf(items, patientUid)
  if (fam.length === 0) return ''
  const names: string[] = []
  for (const r of fam) { const n = r.actorName.trim(); if (n && !names.includes(n)) names.push(n) }
  const who = names.length <= 1 ? subject(names[0] || '가족') : `${names[0]} 외 ${names.length - 1}명이`
  const heart = fam.some((r) => r.kind === 'heart')
  const words = fam.some((r) => r.kind !== 'heart')
  if (heart && words) return `${who} ❤️ 하고 글을 남겼어요`
  return heart ? `${who} ❤️ 보냈어요` : `${who} 글을 남겼어요`
}

/** Something from the family on this photo the parent hasn't looked at. */
export function hasUnseen(items: Reaction[] | undefined, patientUid: string): boolean {
  return familyOf(items, patientUid).some((r) => !r.readByElderAt)
}

/** The one line under a photo: `오전 8:55 · 석촌호수`. */
export function recordLine(m: Memo, place: string): string {
  return [fmtTime(m.takenAt.toDate()), place].filter(Boolean).join(' · ')
}

/** Under a photo the family sent: `오후 8:40 · ❤️ 고마워요 보냄` (what the parent answered). */
export function receivedLine(p: FamilyPhoto): string {
  const answer = p.reply?.kind === 'heart' ? '❤️ 고마워요 보냄' : p.reply?.kind === 'comment' && p.reply.text ? `“${p.reply.text}” 보냄` : ''
  return [fmtTime(new Date(p.createdAtMs)), answer].filter(Boolean).join(' · ')
}

/** One card in the list: the parent's own photo, or one the family sent. */
export type RecordItem = { kind: 'memo'; at: number; memo: Memo } | { kind: 'received'; at: number; photo: FamilyPhoto }

/** The cards by day, newest day first; today newest first, a past day morning first. */
export function recordDays(memos: Memo[], received: FamilyPhoto[], now = new Date()): { day: Date; items: RecordItem[] }[] {
  const items: RecordItem[] = [
    ...memos.map((memo) => ({ kind: 'memo' as const, at: memo.takenAt.toDate().getTime(), memo })),
    ...received.filter((p) => p.status === 'ready' && !!p.photoUrl).map((photo) => ({ kind: 'received' as const, at: photo.createdAtMs, photo })),
  ].sort((a, b) => b.at - a.at)
  const days = new Map<string, { day: Date; items: RecordItem[] }>()
  for (const it of items) {
    const d = new Date(it.at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (!days.has(key)) days.set(key, { day: new Date(d.getFullYear(), d.getMonth(), d.getDate()), items: [] })
    days.get(key)!.items.push(it)
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const out = [...days.values()]
  for (const g of out) if (g.day.getTime() < today) g.items.reverse()
  return out
}
