// The parent's 내 사진 (A14.7): what each large card says, in plain sentences.

import { subject } from './strings'
import { fmtTime } from '../util'
import type { FamilyPhoto, Memo, Reaction } from '../types'

/** The family's hearts and words on one photo (the parent's own excluded). */
function familyOf(items: Reaction[] | undefined, patientUid: string): Reaction[] {
  return (items ?? []).filter((r) => r.actorUid !== patientUid && r.status === 'ready' && (r.kind === 'heart' || r.kind === 'comment' || r.kind === 'voice'))
}

/** Who reacted (each once, in order) and what: hearts, words. */
function familySummary(items: Reaction[] | undefined, patientUid: string): { names: string[]; heart: boolean; words: boolean } | null {
  const fam = familyOf(items, patientUid)
  if (fam.length === 0) return null
  const names: string[] = []
  for (const r of fam) { const n = r.actorName.trim(); if (n && !names.includes(n)) names.push(n) }
  return { names, heart: fam.some((r) => r.kind === 'heart'), words: fam.some((r) => r.kind !== 'heart') }
}

/**
 * `지민이 ❤️ 하고 글을 남겼어요` / `지민이 ❤️ 보냈어요` / `지민이 글을 남겼어요`;
 * several people: `지민 외 1명이 …`. '' when nobody reacted. `plain` spells
 * the heart out (`하트와 글을 남겼어요`) for a screen reader.
 */
export function reactionSentence(items: Reaction[] | undefined, patientUid: string, plain = false): string {
  const f = familySummary(items, patientUid)
  if (!f) return ''
  const who = f.names.length <= 1 ? subject(f.names[0] || '가족') : `${f.names[0]} 외 ${f.names.length - 1}명이`
  if (f.heart && f.words) return plain ? `${who} 하트와 글을 남겼어요` : `${who} ❤️ 하고 글을 남겼어요`
  if (f.heart) return plain ? `${who} 하트를 보냈어요` : `${who} ❤️ 보냈어요`
  return `${who} 글을 남겼어요`
}

/**
 * The chip on a grid tile (A14.7): `❤️` / `💬` / `❤️💬`, and in the roomier
 * 2-column grid the first name too (`❤️ 지민`). '' when nobody reacted.
 */
export function tileChip(items: Reaction[] | undefined, patientUid: string, wide: boolean): string {
  const f = familySummary(items, patientUid)
  if (!f) return ''
  const icons = `${f.heart ? '❤️' : ''}${f.words ? '💬' : ''}`
  return wide && f.names[0] ? `${icons} ${f.names[0]}` : icons
}

/** A tile's whole story for a screen reader: `오전 8:55 사진, 지민이 하트와 글을 남겼어요, 새 소식`. */
export function tileAria(m: Memo, items: Reaction[] | undefined, patientUid: string): string {
  return [`${fmtTime(m.takenAt.toDate())} 사진`, reactionSentence(items, patientUid, true), hasUnseen(items, patientUid) ? '새 소식' : ''].filter(Boolean).join(', ')
}

/** Under a tile: `8:55` / `18:40` in the 3-column grid, `오전 8:55` in the roomier one. */
export function tileTime(m: Memo, wide: boolean): string {
  const d = m.takenAt.toDate()
  return wide ? fmtTime(d) : `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
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
