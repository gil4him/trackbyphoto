// The digest of a parent's day: opening one, and when it goes out.

import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { callWorker } from './worker'
import type { Digest, DigestSettings, Memo } from '../types'

export const DEFAULT_DIGEST: DigestSettings = { cadence: 'daily', hourLocal: 20, tz: 'Asia/Seoul' }

/** Hours offered in 설정 → 하루 요약. */
export const DIGEST_HOURS = [17, 18, 19, 20, 21, 22]

/** Simple edition 알림 시간: when the daily "오늘 사진 n장" notice goes out. */
export const NOTICE_HOURS = [18, 20, 22]

/** The choices to show: the usual three, plus the stored hour if it's another. */
export function noticeHourChoices(current: number): number[] {
  return [...new Set([...NOTICE_HOURS, current])].sort((a, b) => a - b)
}

export function noticeHourLabel(h: number): string {
  if (h >= 22) return `밤 ${h - 12}시`
  if (h >= 17) return `저녁 ${h - 12}시`
  return h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`
}

/** Photos shown on the digest page before "+ 더 보기". */
export const DIGEST_TILES = 9

/** trackbyphoto.web.app/digest/{id} — the link in a push, e-mail or message. */
export function digestIdFromPath(pathname: string): string | null {
  const m = /^\/digest\/([A-Za-z0-9_-]{1,200})\/?$/.exec(pathname)
  return m ? m[1] : null
}

/** The digest, or null when it doesn't exist or isn't ours to read. */
export async function loadDigest(id: string): Promise<Digest | null> {
  try {
    const snap = await getDoc(doc(db, 'digests', id))
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Digest, 'id'>) }) : null
  } catch (err) {
    console.warn('[digest] could not open', err)
    return null
  }
}

/** The first photos of a digest, oldest first. One that has since been deleted is skipped. */
export async function loadDigestMemos(digest: Digest, known: Memo[], max = DIGEST_TILES): Promise<Memo[]> {
  const byId = new Map(known.map((m) => [m.id, m]))
  const found = await Promise.all(digest.memoIds.slice(0, max).map(async (id) => {
    const have = byId.get(id)
    if (have) return have
    try {
      const snap = await getDoc(doc(db, 'memos', id))
      return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Memo, 'id'>) }) : null
    } catch {
      return null
    }
  }))
  return found.filter((m): m is Memo => m !== null)
}

/** Neighbourhoods in the order they were visited, without repeats in a row. */
export function placesVisited(memos: Memo[]): string[] {
  const out: string[] = []
  for (const m of memos) {
    const area = (m.place || '').split(' · ').pop()!.split(',')[0].trim()
    if (area && out[out.length - 1] !== area) out.push(area)
  }
  return out
}

/** "어머니님이 하트 1개, 음성 답장 1개를 남기셨어요" → the short form on the page. */
export function repliesSummary(replies: Digest['replies']): string {
  const texts = replies.texts?.length ?? 0
  return [replies.hearts ? `하트 ${replies.hearts}개` : '', texts ? `글 답장 ${texts}개` : '', replies.voices ? `음성 답장 ${replies.voices}개` : ''].filter(Boolean).join(' · ')
}

export function saveDigestSettings(patientUid: string, changes: Partial<DigestSettings>): Promise<{ digest: DigestSettings }> {
  return callWorker('setDigest', { patientUid, ...changes })
}
