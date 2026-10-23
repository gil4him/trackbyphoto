/**
 * 운영실 할 일 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D2): the rules that turn
 * the service's state into things to look at. Each rule is a pure function
 * over plain rows (tested without Firestore) and gives one item, or none.
 * The handler (handlers/adminInbox.ts) gathers the rows and applies what the
 * admin did with an item (내일 다시 보기, 해결됨).
 *
 * An item's id is its rule plus a short hash of who it is about, so the same
 * people keep one id, and a new person makes a new item that shows again.
 */

import { seoulDate } from './adminMetrics.js'

export type When = 'now' | 'day' | 'wk'
export type RuleId = 'quietParent' | 'workerDown' | 'memoSlow' | 'unpaired' | 'noGuardian' | 'familyLimit' | 'costOverBudget' | 'disabledAccount'

export interface InboxRow { name: string; fact: string; value: string }
export interface InboxTarget { uid: string; kind: 'parent' | 'child' }
export interface InboxItem {
  id: string
  rule: RuleId
  when: When
  category: string
  title: string
  sub: string
  why: string
  /** Up to 8 rows: a name, a fact, a number; the rest summed up in the last
   *  row. Objects, not tuples: Firestore stores no array inside an array. */
  rows: InboxRow[]
  targets: InboxTarget[]
}

export interface InboxParent {
  uid: string
  name: string
  createdAtMs: number | null
  tier: string
  /** Active family members (memberships to someone else). */
  family: number
  guardians: number
  devicesActive: number
}
export interface InboxAccount { uid: string; kind: 'parent' | 'child'; name: string; email: string | null; disabled: boolean }

export interface InboxInput {
  now: number
  parents: InboxParent[]
  accounts: InboxAccount[]
  /** Photos by when they were taken, at least the last 10 days. */
  memos: { patientUid: string; atMs: number }[]
  worker: { lastSeenMs: number | null; modelUp: boolean | null }
  /** Median memo time over the last 15 minutes (D7); null until measured. */
  memoP50Ms: number | null
  /** Family members each plan allows (admin_config/plans). */
  familyLimits: Record<string, number>
  /** This month's Firebase cost and budget (admin_config/dashboard.costs). */
  cost: { month: string; firebaseUSD: number | null; budgetUSD: number }
}

const H = 3_600_000
const D = 24 * H
const MAX_ROWS = 8

/** FNV-1a, enough to tell one set of people from another in an id. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}
const idOf = (rule: RuleId, keys: string[]) => `${rule}-${shortHash([...keys].sort().join(','))}`

const row = (name: string, fact: string, value: string): InboxRow => ({ name, fact, value })

function capRows(rows: InboxRow[], unit: string): InboxRow[] {
  if (rows.length <= MAX_ROWS) return rows
  return [...rows.slice(0, MAX_ROWS - 1), row(`외 ${rows.length - (MAX_ROWS - 1)}${unit}`, '', '')]
}

export function hoursAgo(ms: number | null, now: number): string {
  if (ms === null) return '—'
  const h = Math.floor((now - ms) / H)
  return h < 48 ? `${h}시간` : `${Math.floor(h / 24)}일`
}

/** Sent photos on ≥5 of the 7 days before the last 72 hours, and none since. */
export function quietParent(i: InboxInput): InboxItem | null {
  const quietFrom = i.now - 72 * H
  const usualFrom = quietFrom - 7 * D
  const rows: InboxRow[] = []
  const targets: InboxTarget[] = []
  for (const p of i.parents) {
    const mine = i.memos.filter((m) => m.patientUid === p.uid)
    if (mine.some((m) => m.atMs >= quietFrom)) continue
    const days = new Set(mine.filter((m) => m.atMs >= usualFrom && m.atMs < quietFrom).map((m) => seoulDate(m.atMs)))
    if (days.size < 5) continue
    const last = Math.max(...mine.map((m) => m.atMs))
    rows.push(row(p.name, `평소 7일 중 ${days.size}일`, hoursAgo(last, i.now)))
    targets.push({ uid: p.uid, kind: 'parent' })
  }
  if (!rows.length) return null
  return {
    id: idOf('quietParent', targets.map((t) => t.uid)), rule: 'quietParent', when: 'now', category: '사용자',
    title: `부모님 ${rows.length}분이 3일째 사진이 없어요`,
    sub: '평소 거의 매일 사진을 보내던 분들이에요',
    why: '휴대폰이 꺼졌거나 앱이 지워졌을 수 있어요. 가족이 먼저 알 수 있게 살펴봐 주세요.',
    rows: capRows(rows, '분'), targets,
  }
}

/** No beat for 4 minutes, or the model not answering. */
export function workerDown(i: InboxInput): InboxItem | null {
  const stale = i.worker.lastSeenMs === null || i.now - i.worker.lastSeenMs > 4 * 60_000
  if (!stale && i.worker.modelUp !== false) return null
  const ago = i.worker.lastSeenMs === null ? '신호 없음' : `${Math.round((i.now - i.worker.lastSeenMs) / 60_000)}분 전`
  return {
    id: idOf('workerDown', [stale ? 'stale' : 'model']), rule: 'workerDown', when: 'now', category: '시스템',
    title: stale ? '메모 서버(Mac mini)의 신호가 끊겼어요' : 'AI 모델이 응답하지 않아요',
    sub: stale ? (i.worker.lastSeenMs === null ? '서버 신호가 한 번도 오지 않았어요' : `마지막 신호 ${ago}`) : '사진은 들어오지만 메모를 쓰지 못해요',
    why: '사진은 안전하게 쌓이지만, 서버가 돌아올 때까지 가족에게 메모가 가지 않아요. Mac mini가 켜져 있는지, 워커 로그를 확인해 주세요.',
    rows: [row('마지막 신호', '', ago), row('AI 모델', '', i.worker.modelUp === null ? '—' : i.worker.modelUp ? '응답 중' : '응답 없음')],
    targets: [],
  }
}

/** Memos take more than 30 seconds (median over the last 15 minutes). */
export function memoSlow(i: InboxInput): InboxItem | null {
  if (i.memoP50Ms === null || i.memoP50Ms <= 30_000) return null
  const s = Math.round(i.memoP50Ms / 1000)
  return {
    id: idOf('memoSlow', ['p50']), rule: 'memoSlow', when: 'now', category: '시스템',
    title: `메모 쓰는 시간이 느려졌어요 (중간값 ${s}초)`,
    sub: '최근 15분 동안의 메모',
    why: '사진이 몰리면 대기열이 길어져요. 메모는 늦게라도 모두 써지지만, 계속되면 시스템 화면에서 확인해 주세요.',
    rows: [row('메모 시간 중간값', '최근 15분', `${s}초`)], targets: [],
  }
}

/** Registered over 24 hours ago, and still no phone linked. */
export function unpaired(i: InboxInput): InboxItem | null {
  const list = i.parents.filter((p) => p.devicesActive === 0 && p.family > 0 && p.createdAtMs !== null && i.now - p.createdAtMs > D)
  if (!list.length) return null
  return {
    id: idOf('unpaired', list.map((p) => p.uid)), rule: 'unpaired', when: 'day', category: '연결',
    title: `휴대폰 연결을 안 한 가족 ${list.length}곳`,
    sub: '등록 후 하루 넘게 부모님 휴대폰이 연결되지 않았어요',
    why: '가족은 부모님을 등록했지만 부모님 휴대폰에서 아직 연결하지 않았어요. 연결이 안 되면 사진이 오지 않아요.',
    rows: capRows(list.map((p) => row(p.name, `등록 ${hoursAgo(p.createdAtMs, i.now)} 전`, `가족 ${p.family}명`)), '곳'),
    targets: list.map((p) => ({ uid: p.uid, kind: 'parent' })),
  }
}

/** A parent nobody manages as 대표 가족. */
export function noGuardian(i: InboxInput): InboxItem | null {
  const list = i.parents.filter((p) => p.guardians === 0)
  if (!list.length) return null
  return {
    id: idOf('noGuardian', list.map((p) => p.uid)), rule: 'noGuardian', when: 'day', category: '가족',
    title: `대표 가족이 없는 부모님 ${list.length}분`,
    sub: '설정을 바꾸고 휴대폰을 관리할 사람이 없어요',
    why: '대표 가족이 없으면 휴대폰 연결, 플랜, 계정 삭제를 맡을 사람이 없어요. 남은 가족 중 한 명을 대표로 정해 주세요.',
    rows: capRows(list.map((p) => row(p.name, `가족 ${p.family}명`, p.devicesActive ? '휴대폰 연결됨' : '휴대폰 없음')), '분'),
    targets: list.map((p) => ({ uid: p.uid, kind: 'parent' })),
  }
}

/** At the plan's family limit: a Plus candidate. */
export function familyLimit(i: InboxInput): InboxItem | null {
  const list = i.parents.filter((p) => typeof i.familyLimits[p.tier] === 'number' && p.family >= i.familyLimits[p.tier])
  if (!list.length) return null
  return {
    id: idOf('familyLimit', list.map((p) => p.uid)), rule: 'familyLimit', when: 'wk', category: '매출',
    title: `가족 수 한도에 걸린 가족 ${list.length}곳`,
    sub: '더 큰 플랜 안내 후보예요',
    why: '지금 플랜의 가족 수를 다 채웠어요. 가족을 더 초대하려면 더 큰 플랜이 필요해요.',
    rows: capRows(list.map((p) => row(p.name, p.tier, `가족 ${p.family}/${i.familyLimits[p.tier]}명`)), '곳'),
    targets: list.map((p) => ({ uid: p.uid, kind: 'parent' })),
  }
}

/** This month's Firebase cost (entered on 비용) is over the budget. */
export function costOverBudget(i: InboxInput): InboxItem | null {
  const { firebaseUSD, budgetUSD, month } = i.cost
  if (firebaseUSD === null || !(firebaseUSD > budgetUSD)) return null
  return {
    id: idOf('costOverBudget', [month]), rule: 'costOverBudget', when: 'wk', category: '비용',
    title: `Firebase 비용이 예산 $${budgetUSD}를 넘었어요`,
    sub: `이번 달 $${firebaseUSD.toFixed(2)}`,
    why: '입력한 이번 달 Firebase 비용이 예산보다 많아요. 비용 화면에서 어디에 쓰였는지 보고, 예산을 현실에 맞게 고쳐 주세요.',
    rows: [row('이번 달', month, `$${firebaseUSD.toFixed(2)}`), row('예산', '', `$${budgetUSD}`)], targets: [],
  }
}

/** Sign-in blocked (관리자가 막은 계정). */
export function disabledAccount(i: InboxInput): InboxItem | null {
  const list = i.accounts.filter((a) => a.disabled)
  if (!list.length) return null
  return {
    id: idOf('disabledAccount', list.map((a) => a.uid)), rule: 'disabledAccount', when: 'wk', category: '계정',
    title: `로그인이 막힌 계정 ${list.length}개`,
    sub: '관리자가 차단한 계정이에요',
    why: '차단한 이유가 해결됐다면 풀어 주고, 필요 없는 계정이면 삭제를 검토해 주세요.',
    rows: capRows(list.map((a) => row(a.name, a.kind === 'parent' ? '부모님' : '가족', a.email ?? '')), '개'),
    targets: list.map((a) => ({ uid: a.uid, kind: a.kind })),
  }
}

export const RULES = [quietParent, workerDown, memoSlow, unpaired, noGuardian, familyLimit, costOverBudget, disabledAccount]
const ORDER: Record<When, number> = { now: 0, day: 1, wk: 2 }

export function inboxItems(i: InboxInput): InboxItem[] {
  return RULES.map((r) => r(i)).filter((x): x is InboxItem => x !== null).sort((a, b) => ORDER[a.when] - ORDER[b.when])
}

export interface ItemState { state: 'snoozed' | 'resolved'; until: number | null }

/** What the admin did with an item: 해결됨 hides it while it lasts; 내일 다시
 *  보기 hides it until `until`. Also says which saved states are spent: a
 *  resolved item whose condition cleared, or a snooze that ran out. */
export function applyStates(items: InboxItem[], states: Record<string, ItemState>, now: number): { open: InboxItem[]; hidden: number; spent: string[] } {
  const isHidden = (s: ItemState | undefined) => !!s && (s.state === 'resolved' || (s.state === 'snoozed' && s.until !== null && s.until > now))
  const open = items.filter((it) => !isHidden(states[it.id]))
  const present = new Set(items.map((it) => it.id))
  const spent = Object.entries(states)
    .filter(([id, s]) => (s.state === 'resolved' && !present.has(id)) || (s.state === 'snoozed' && (s.until === null || s.until <= now)))
    .map(([id]) => id)
  return { open, hidden: items.length - open.length, spent }
}

/** The month key admin_config/dashboard.costs uses, in Seoul. */
export const monthKey = (now: number) => seoulDate(now).slice(0, 7)

/** admin_config/dashboard.costs[month] → this month's cost and budget ($5 when unset). */
export function costOf(dashboard: Record<string, unknown> | undefined, now: number): InboxInput['cost'] {
  const month = monthKey(now)
  const costs = (dashboard?.costs ?? {}) as Record<string, { firebaseUSD?: unknown; budgetUSD?: unknown }>
  const entry = costs[month] ?? {}
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    month,
    firebaseUSD: num(entry.firebaseUSD),
    budgetUSD: num(entry.budgetUSD) ?? num(dashboard?.budgetUSD) ?? 5,
  }
}

/** admin_config/dashboard.inbox, read defensively. */
export function statesOf(dashboard: Record<string, unknown> | undefined): Record<string, ItemState> {
  const raw = (dashboard?.inbox ?? {}) as Record<string, { state?: unknown; until?: unknown }>
  const out: Record<string, ItemState> = {}
  for (const [id, s] of Object.entries(raw)) {
    if (s?.state !== 'snoozed' && s?.state !== 'resolved') continue
    const u = s.until as { toMillis?: () => number } | number | null | undefined
    out[id] = { state: s.state, until: typeof u === 'number' ? u : typeof u?.toMillis === 'function' ? u.toMillis() : null }
  }
  return out
}
