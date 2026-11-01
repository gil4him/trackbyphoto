/**
 * 따뜻한 한 줄 (owner decision, 2026-11-01): a line under every photo's memo, to
 * warm, delight or comfort whoever reads it, in its own field (`memos.funLine`).
 * It replaces the counted-fact jokes of 2026-10-30. The sentence comes from the
 * owner's approved library (warmLines.ts), chosen here by the photo's category
 * with no model, so nothing can be invented. The memo itself (title, scene, the
 * memory diary prompt) is never read back into or changed by this step, and a
 * failure here only means a photo without the line. Behind `memoFunLine`, or
 * admin_config/funLine ({ allow: [uid] }) to try it on one family first.
 */

import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { flagOn } from '../plans.js'
import { WARM_LINES, type LineGroup } from './warmLines.js'

export interface FunMemo {
  activity: string
  memo: string
  scene: string
}

/** No line at all (owner, 2026-11-01). */
const FUNERAL = /장례|빈소|납골|추모|영결|묘지|funeral|memorial|cemetery|graveside/i
/** Only the quiet lines, which never mention why they were there. */
const QUIET = /병원|약국|응급|수술|요양|치과|한의원|진료|입원|hospital|pharmacy|clinic|doctor|dentist|surgery|emergency room|nursing home/i
const GROUPS: Record<string, LineGroup> = {
  식사: 'meal', 카페: 'cafe', 산책: 'outdoors', 운동: 'outdoors', 자연: 'outdoors',
  여행: 'going', 출장: 'going', 이동: 'going', 쇼핑: 'shopping', 휴식: 'rest', 모임: 'together',
}
/** Lines an account has seen lately are not picked again while others are left. */
const RECENT = 30

function hash(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

/** The line for this photo, or null for a funeral. Two of three come from the photo's category. */
export function chooseLine(args: { memoId: string; current: FunMemo; lang: string | undefined; recent: string[] }): string | null {
  const { memoId, current, lang, recent } = args
  const text = `${current.activity} ${current.memo} ${current.scene}`
  if (FUNERAL.test(text)) return null
  const lines = WARM_LINES[lang === 'en' ? 'en' : 'ko']
  const h = hash(memoId)
  const fresh = (pool: readonly string[]) => pool.filter((l) => !recent.includes(l))
  const pick = (pool: readonly string[]) => pool[h % pool.length]
  if (QUIET.test(text)) {
    const left = fresh(lines.quiet)
    return pick(left.length ? left : lines.quiet)
  }
  const group = GROUPS[current.activity]
  const own = group && h % 3 !== 0 ? fresh(lines[group]) : []
  if (own.length) return pick(own)
  const any = fresh(lines.any)
  return pick(any.length ? any : lines.any)
}

let allowCache: { value: Set<string>; expiresAt: number } | null = null
export function resetFunLineCache() { allowCache = null }

async function allowed(patientUid: string): Promise<boolean> {
  if (await flagOn('memoFunLine')) return true
  const now = Date.now()
  if (!allowCache || allowCache.expiresAt <= now) {
    const allow = (await getFirestore().doc('admin_config/funLine').get()).data()?.allow
    allowCache = { value: new Set(Array.isArray(allow) ? allow.filter((u): u is string => typeof u === 'string') : []), expiresAt: now + 60_000 }
  }
  return allowCache.value.has(patientUid)
}

export interface FunLineArgs {
  memoId: string
  patientUid: string
  current: FunMemo
  lang: string | undefined
}

/** Add the line to a memo just finished. */
export async function addFunLine(args: FunLineArgs): Promise<void> {
  const { memoId, patientUid, current, lang } = args
  if (!current.memo) return
  if (!(await allowed(patientUid))) return

  const db = getFirestore()
  const snap = await db.collection('memos')
    .where('patientUid', '==', patientUid)
    .orderBy('takenAt', 'desc')
    .limit(RECENT)
    .get()
  const recent = snap.docs.flatMap((d) => {
    const line = d.id === memoId ? undefined : d.data().funLine
    return typeof line === 'string' ? [line] : []
  })
  const line = chooseLine({ memoId, current, lang, recent })
  if (!line) return
  await db.doc(`memos/${memoId}`).update({ funLine: line, funLineAt: FieldValue.serverTimestamp() })
  logger.info('[funLine] added', { memoId })
}
