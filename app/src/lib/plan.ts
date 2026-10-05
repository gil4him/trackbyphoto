// What the plan sheet and 목소리 앨범 show. No Firebase in here.
//
// Every number comes from admin_config/plans; nothing about a tier is
// hard-coded except its name. Photo allowances (AI memos a day, the
// fair-use guard) are deliberately never turned into text: photos are
// unlimited on every plan and no screen counts them against anything.

import { S } from './strings'
import type { Plans, PlanEntitlements, PlanTier, Reaction } from '../types'

export const TIERS: PlanTier[] = ['free', 'basic', 'plus', 'family']
export const TIER_NAME: Record<PlanTier, string> = { free: 'Free', basic: 'Basic', plus: 'Plus', family: 'Family' }
/** The name with its subject particle, for "… 필요해요". */
const TIER_SUBJECT: Record<PlanTier, string> = { free: 'Free가', basic: 'Basic이', plus: 'Plus가', family: 'Family가' }

const DAY_MS = 24 * 3600 * 1000
/** A changed plan keeps everything for a week before retention starts (worker: NOTICE_DAYS). */
const GRACE_DAYS = 7

/** Why the sheet was opened: one of the three upgrade moments, or 설정. */
export type PlanReason =
  | { kind: 'settings' }
  /** 가족초대 at the plan's count. */
  | { kind: 'family'; limit: number; nextTier?: PlanTier | null }
  /** The locked voice card; `count` replies are waiting. */
  | { kind: 'voice'; count: number }
  /** The "사진이 지워져요" notice, with its own words. */
  | { kind: 'retention'; message: string }

/** "7일", "30일", "1년", "평생". */
export function keptFor(days: number | null): string {
  if (days == null) return '평생'
  return days >= 365 && days % 365 === 0 ? `${days / 365}년` : `${days}일`
}

/**
 * The lines on one plan's card. `flags` keeps a card from promising
 * something that isn't switched on yet.
 */
export function planLines(ent: PlanEntitlements, patientName: string, flags: Plans['flags'] = {}): string[] {
  const digest = flags.digest === true
  const voice = flags.voiceReplies === true
  return [
    !digest ? '앱 알림' : ent.messenger ? '매일 카카오톡 요약' : '앱 알림 + 이메일 요약',
    voice && ent.voiceReplies ? `${patientName} 음성 답장 듣기` : '',
    digest && ent.weekly ? '주간 하이라이트' : '',
    digest && ent.checkin ? '“오늘 사진 없음” 안심 알림' : '',
    digest && ent.recap ? '월간 AI 앨범' : '',
    voice && ent.voiceAlbum ? '목소리 앨범' : '',
    ent.seniors > 1 ? `부모님 ${ent.seniors}분` : '',
    `가족 ${ent.familyMembers}명`,
    `${keptFor(ent.retentionDays)} 보관`,
  ].filter(Boolean)
}

/** The plan the sheet points at for this reason; null when none fits (or from 설정). */
export function suggestedTier(plans: Plans, current: PlanTier, reason: PlanReason): PlanTier | null {
  const higher = TIERS.slice(TIERS.indexOf(current) + 1).filter((t) => plans[t])
  if (reason.kind === 'family') {
    if (reason.nextTier !== undefined) return reason.nextTier
    return higher.find((t) => plans[t].familyMembers > reason.limit) ?? null
  }
  if (reason.kind === 'voice') return higher.find((t) => plans[t].voiceReplies) ?? null
  if (reason.kind === 'retention') {
    const mine = plans[current]?.retentionDays
    if (mine == null) return null
    return higher.find((t) => plans[t].retentionDays == null || plans[t].retentionDays! > mine) ?? null
  }
  return null
}

/** The line under the title that says why the sheet opened. */
export function reasonLine(reason: PlanReason, patientName: string, suggested: PlanTier | null): string {
  if (reason.kind === 'family') return S.planLimitFamily(reason.limit, suggested ? TIER_SUBJECT[suggested] : '')
  if (reason.kind === 'voice') return reason.count > 0 ? S.planVoiceWaiting(patientName, reason.count) : `${patientName} 목소리로 답장을 받아보세요`
  if (reason.kind === 'retention') return reason.message
  return ''
}

/** What is kept for a parent, as loaded for the strip. */
export interface Memory {
  count: number
  /** When the oldest kept photo was taken; null when there are none. */
  oldestMs: number | null
}

/**
 * Days until the oldest photo goes, or null when nothing is going to be
 * deleted: the retention job is off, nobody has put this parent on a plan
 * (such an account keeps everything), or the plan keeps photos for good.
 */
export function daysUntilOldestGoes(a: {
  memory: Memory
  retentionDays: number | null
  retentionOn: boolean
  /** The parent was put on a plan (users.plan exists), and when. */
  planSinceMs: number | null | undefined
  nowMs: number
}): number | null {
  if (!a.retentionOn || a.retentionDays == null || a.planSinceMs === undefined || a.memory.oldestMs == null) return null
  const goesAt = Math.max(a.memory.oldestMs + a.retentionDays * DAY_MS, (a.planSinceMs ?? 0) + GRACE_DAYS * DAY_MS)
  return Math.max(0, Math.ceil((goesAt - a.nowMs) / DAY_MS))
}

/**
 * Would moving to `to` delete photos that are kept today? True when the
 * retention job is on and the new plan keeps photos for a shorter time than
 * now (an account nobody has put on a plan keeps everything).
 */
export function shortensKeeping(plans: Plans, hasPlan: boolean, current: PlanTier, to: PlanTier): boolean {
  if (plans.flags?.retentionJob !== true) return false
  const next = plans[to]?.retentionDays
  if (next == null) return false
  const now = hasPlan ? plans[current]?.retentionDays ?? null : null
  return now == null || next < now
}

/** The parent's playable voice replies, newest month first: "2026년 10월". */
export function albumMonths(voices: Reaction[], patientUid: string): Array<{ label: string; items: Reaction[] }> {
  const out: Array<{ label: string; items: Reaction[] }> = []
  const mine = voices
    .filter((r) => r.kind === 'voice' && r.actorUid === patientUid && r.status === 'ready' && !!r.audioUrl)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
  for (const r of mine) {
    const d = new Date(r.createdAtMs)
    const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월`
    if (out[out.length - 1]?.label !== label) out.push({ label, items: [] })
    out[out.length - 1].items.push(r)
  }
  return out
}
