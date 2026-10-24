// 운영실 할 일 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D2): the worker's items
// (worker/src/adminInbox.ts) and what the admin does with one. 내일 다시 보기
// and 해결됨 are kept in admin_config/dashboard.inbox, which the admin may
// write; the worker reads them back and clears spent ones.

import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { callWorker } from './worker'
import { filterForRule } from './adminFamilies'
import type { FamilyFilter } from './admin'

export type When = 'now' | 'day' | 'wk'
export interface InboxItem {
  id: string
  rule: string
  when: When
  category: string
  title: string
  sub: string
  why: string
  rows: { name: string; fact: string; value: string }[]
  targets: { uid: string; kind: 'parent' | 'child' }[]
}
export interface Inbox { items: InboxItem[]; hidden: number; at: string }

export const adminInbox = (refresh = false) =>
  callWorker<Inbox>('adminInbox', refresh ? { refresh: true } : {}, { timeoutMs: 60_000 })

export const WHEN_KO: Record<When, string> = { now: '지금', day: '오늘', wk: '이번 주' }
export const WHEN_ORDER: When[] = ['now', 'day', 'wk']

export function groupByWhen(items: InboxItem[]): { when: When; items: InboxItem[] }[] {
  return WHEN_ORDER.map((when) => ({ when, items: items.filter((i) => i.when === when) })).filter((g) => g.items.length > 0)
}

/** The first `n` items, in 지금 → 오늘 → 이번 주 order (the 오늘 card). */
export function topItems(items: InboxItem[], n: number): InboxItem[] {
  return WHEN_ORDER.flatMap((w) => items.filter((i) => i.when === w)).slice(0, n)
}

/** 내일 다시 보기: hidden for 24 hours. 해결됨: hidden until the condition clears. */
export async function setItemState(id: string, state: 'snoozed' | 'resolved', now = Date.now()): Promise<void> {
  await setDoc(doc(db, 'admin_config', 'dashboard'), {
    inbox: { [id]: { state, until: state === 'snoozed' ? Timestamp.fromMillis(now + 24 * 3600_000) : null, at: serverTimestamp() } },
  }, { merge: true })
}

/** Where 열기 goes: one person, the 가족 list, or the view the item is about. */
export function openTarget(item: InboxItem): { uid: string } | { tab: 'families'; kind: 'parent' | 'child'; filter: FamilyFilter } | { tab: 'system' | 'costs' } {
  if (item.targets.length === 1) return { uid: item.targets[0].uid }
  if (item.targets.length > 1) {
    const kind = item.targets.every((t) => t.kind === 'child') ? 'child' : 'parent'
    return { tab: 'families', kind, filter: kind === 'parent' ? filterForRule(item.rule) : 'all' }
  }
  return { tab: item.rule === 'costOverBudget' ? 'costs' : 'system' }
}

/** "할 일은 이렇게 골라요": every rule in plain words, and what is not connected yet. */
export const RULE_GUIDE: { when: When | 'off'; title: string; text: string }[] = [
  { when: 'now', title: '3일 사진 없음', text: '평소 7일 중 5일 넘게 사진을 보내던 부모님이 72시간 동안 0장' },
  { when: 'now', title: '메모 서버 멈춤', text: '서버 신호가 4분 넘게 없거나 AI 모델이 응답하지 않을 때' },
  { when: 'now', title: '메모 느림', text: '최근 15분 메모 시간 중간값이 30초 넘을 때 (시스템 화면에서 재기 시작해요)' },
  { when: 'day', title: '휴대폰 미연결', text: '가족이 등록한 지 24시간이 지났는데 부모님 휴대폰 연결이 없을 때' },
  { when: 'day', title: '대표 가족 없음', text: '부모님을 관리하는 대표 가족이 없을 때' },
  { when: 'wk', title: '가족 한도', text: '지금 플랜의 가족 수를 다 채운 가족 (더 큰 플랜 후보)' },
  { when: 'wk', title: '비용 초과', text: '입력한 이번 달 Firebase 비용이 예산을 넘을 때' },
  { when: 'wk', title: '로그인 차단', text: '관리자가 막아 둔 계정' },
  { when: 'off', title: '스토어 리뷰', text: '★1–2 새 리뷰 · 연결 필요' },
  { when: 'off', title: '이메일 삭제 요청', text: '설정 밖에서 온 계정 삭제 요청 · 연결 필요' },
  { when: 'off', title: '앱 심사 상태', text: 'App Store·Google Play 심사 · 연결 필요' },
]
