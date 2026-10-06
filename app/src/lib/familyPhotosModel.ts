// What the screens make of a parent's family photos. No Firebase in here.

import type { FamilyPhoto } from '../types'
import { S } from './strings'

/** Photos the parent's phone can show, newest first. */
export function showable(photos: FamilyPhoto[]): FamilyPhoto[] {
  return photos.filter((p) => p.status === 'ready' && !!p.photoUrl).sort((a, b) => b.createdAtMs - a.createdAtMs)
}

/** Not yet looked at on the parent's phone. */
export const unseen = (photos: FamilyPhoto[]) => showable(photos).filter((p) => !p.seenAtMs)

/** The card line on the parent's home screen; null when there is nothing to show. */
export function cardLine(photos: FamilyPhoto[]): { line: string; lit: boolean } | null {
  const all = showable(photos)
  if (all.length === 0) return null
  const fresh = unseen(photos)
  if (fresh.length === 0) return { line: S.familyPhotoCardOld, lit: false }
  const senders = [...new Set(fresh.map((p) => p.senderName))]
  return { line: S.familyPhotoCardNew(senders[0], senders.length - 1, fresh.length), lit: true }
}

/** The order the viewer walks through: new ones first, then the rest. */
export function viewerOrder(photos: FamilyPhoto[]): FamilyPhoto[] {
  const all = showable(photos)
  return [...all.filter((p) => !p.seenAtMs), ...all.filter((p) => !!p.seenAtMs)]
}

/** What the sender sees under a photo they sent. */
export function sentStatus(p: FamilyPhoto): string {
  if (p.reply?.kind === 'comment' && p.reply.text) return `“${p.reply.text}”`
  if (p.reply?.kind === 'heart') return '❤️ 고마워요'
  if (p.seenAtMs) return '봤어요'
  if (p.status === 'ready') return '보냈어요'
  return '보내는 중…'
}

/** How many of these were sent today by `uid` (local day). */
export function sentToday(photos: FamilyPhoto[], uid: string, nowMs = Date.now()): number {
  const d = new Date(nowMs)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return photos.filter((p) => p.senderUid === uid && p.createdAtMs >= start).length
}
