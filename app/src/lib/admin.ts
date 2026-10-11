// The admin dashboard's side of the worker (worker/src/handlers/adminPeople.ts).
//
// Types mirror what the worker returns (timestamps as ISO strings, since the
// request queue carries plain JSON). The one admin identity is the email the
// rules and the worker both check; nothing here grants access — a non-admin
// request simply comes back 'permission-denied'.

import type { User } from 'firebase/auth'
import { callWorker } from './worker'
import type { PlanTier } from '../types'

/** Single source of truth for the admin email. Mirrored in firestore.rules
 *  and worker/src/handlers/admin.ts. */
export const ADMIN_EMAIL = 'zymer4him@gmail.com'

export function isAdminUser(user: Pick<User, 'email'> | null | undefined): boolean {
  return !!user && user.email === ADMIN_EMAIL
}

export type PersonKind = 'parent' | 'child'

export interface AdminPerson {
  uid: string
  kind: PersonKind
  name: string
  email: string | null
  providers: string[]
  disabled: boolean
  isAdmin: boolean
  createdAt: string | null
  lastSignInAt: string | null
  lastRefreshAt: string | null
  hasSettings: boolean
  plan: { tier: PlanTier; status: string | null; since: string | null; explicit: boolean }
  memos: { count: number; lastAt: string | null }
  /** For a parent: who looks after them. For a child: the parents they look after. */
  links: { active: number; guardians: number }
  devices: { active: number; total: number }
}

export interface AdminLink {
  id: string
  patientUid: string
  caregiverUid: string
  role: string
  status: string
  caregiverName: string | null
  otherName: string
  otherEmail: string | null
  createdAt: string | null
  acceptedAt: string | null
  revokedAt: string | null
}

export interface AuditRow {
  id: string
  patientUid: string
  actorUid: string
  action: string
  details: Record<string, unknown>
  timestamp: string | null
}

export interface AdminDevice {
  id: string
  name: string
  platform: string
  status: string
  pairedAt: string | null
  pairedVia: string | null
  revokedAt: string | null
}

export interface AdminPersonDetail extends AdminPerson {
  settings: Record<string, unknown> | null
  linkList: AdminLink[]
  deviceList: AdminDevice[]
  pairings: { id: string; purpose: string; mode: string; status: string; createdAt: string | null; expiresAt: string | null; deviceInfo: unknown }[]
  consents: { id: string; type: string; grantedBy: string; guardianUid: string | null; consentTextVersion: string; timestamp: string | null }[]
  audit: AuditRow[]
  planHistory: AuditRow[]
  counts: { reactions: number; familyPhotos: number; notifications: number }
}

/** admin_log/{id} — what the admin did, kept after the person is gone. */
export interface AdminLogRow {
  id: string
  action: string
  actorUid: string
  targetUid: string
  targetName: string
  details: Record<string, unknown>
  timestamp: { toDate: () => Date } | null
}

/** Settings fields the dashboard may change (the worker enforces the same list). */
export type EditableSettings = Partial<{
  patientName: string
  cadence: 'realtime' | 'daily' | 'weekly'
  autoMode: boolean
  bigText: boolean
  retention: '30' | '90' | 'forever'
  geoLang: 'ko' | 'en'
  voiceEnabled: boolean
  textReplies: 'full' | 'quick' | 'off'
}>

// Listing every account is a few reads per person on the Mac mini; give it room.
const LIST_TIMEOUT = 90_000
const ACTION_TIMEOUT = 60_000

export const adminListPeople = () =>
  callWorker<{ people: AdminPerson[] }>('adminListPeople', {}, { timeoutMs: LIST_TIMEOUT }).then((r) => r.people)

export const adminGetPerson = (uid: string) =>
  callWorker<AdminPersonDetail>('adminGetPerson', { uid }, { timeoutMs: ACTION_TIMEOUT })

export const adminDeleteAccount = (uid: string) =>
  callWorker<{ ok: true; kind: PersonKind }>('adminDeleteAccount', { uid }, { timeoutMs: ACTION_TIMEOUT })

export const adminUnlinkDevice = (patientUid: string, deviceId: string) =>
  callWorker<{ ok: true }>('adminUnlinkDevice', { patientUid, deviceId }, { timeoutMs: ACTION_TIMEOUT })

export const adminSetMembership = (
  patientUid: string,
  caregiverUid: string,
  change: { role: string } | { revoke: true },
  force = false,
) => callWorker<{ ok: true }>('adminSetMembership', { patientUid, caregiverUid, ...change, force }, { timeoutMs: ACTION_TIMEOUT })

export const adminSetPlan = (patientUid: string, tier: PlanTier) =>
  callWorker<{ ok: true; tier: PlanTier; changed: boolean }>('adminSetPlan', { patientUid, tier }, { timeoutMs: ACTION_TIMEOUT })

export const adminUpdateSettings = (uid: string, patch: EditableSettings) =>
  callWorker<{ ok: true }>('adminUpdateSettings', { uid, patch }, { timeoutMs: ACTION_TIMEOUT })

export const adminSetDisabled = (uid: string, disabled: boolean) =>
  callWorker<{ ok: true; disabled: boolean }>('adminSetDisabled', { uid, disabled }, { timeoutMs: ACTION_TIMEOUT })

// ── display helpers ─────────────────────────────────────────────────────────

export const KIND_KO: Record<PersonKind, string> = { parent: '부모님', child: '가족' }

export const ROLE_KO: Record<string, string> = { guardian: '대표 가족', admin: '관리 가족', viewer: '보기만' }

export const PROVIDER_KO: Record<string, string> = {
  'google.com': 'Google',
  'apple.com': 'Apple',
  'password': '이메일',
  'phone': '전화',
}

/** Korean label for an audit / admin_log action; unknown keys show as-is. */
export const ACTION_KO: Record<string, string> = {
  'elder.create': '부모님 등록',
  'elder.delete': '부모님 삭제',
  'account.delete': '계정 삭제',
  'account.disable': '로그인 차단',
  'account.enable': '로그인 차단 해제',
  'device.pair': '휴대폰 연결',
  'device.unlink': '휴대폰 연결 해제',
  'pairing.create': '연결 코드 발급',
  'pairing.approve': '재연결 승인',
  'pairing.deny': '재연결 거절',
  'membership.revoke': '가족 접근 해제',
  'membership.role': '가족 역할 변경',
  'membership.accept': '가족 초대 수락',
  'caregiver.invite': '가족 초대',
  'caregiver.accept': '가족 초대 수락',
  'caregiver.revoke': '가족 접근 해제',
  'consent.grant': '동의',
  'settings.update': '설정 변경',
  'recipient.add': '받는 사람 추가',
  'recipient.remove': '받는 사람 삭제',
  'plan.change': '요금제 변경',
  'digest.set': '알림 시간 변경',
}

export function actionLabel(action: string): string {
  return ACTION_KO[action] ?? action
}

/** "2026. 10. 11. 오후 3:07" or "—". */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "3일 전", "방금", "—" — for list columns. */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return '방금'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}분 전`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}일 전`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}개월 전`
  return `${Math.round(mo / 12)}년 전`
}

/** The flags a row in the people list wears. */
export function personFlags(p: AdminPerson): { key: string; label: string; tone: 'warn' | 'bad' | 'info' }[] {
  const out: { key: string; label: string; tone: 'warn' | 'bad' | 'info' }[] = []
  if (p.disabled) out.push({ key: 'disabled', label: '로그인 차단', tone: 'bad' })
  if (p.isAdmin) out.push({ key: 'admin', label: '관리자', tone: 'info' })
  if (p.kind === 'parent') {
    if (p.links.guardians === 0) out.push({ key: 'no-guardian', label: '대표 가족 없음', tone: 'bad' })
    if (p.devices.active === 0) out.push({ key: 'no-phone', label: '휴대폰 미연결', tone: 'warn' })
  } else if (p.links.active === 0 && !p.isAdmin) {
    out.push({ key: 'no-parent', label: '연결된 부모님 없음', tone: 'warn' })
  }
  return out
}

/** Case-insensitive match on name, email or uid. */
export function matchesQuery(p: AdminPerson, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return p.name.toLowerCase().includes(s)
    || (p.email ?? '').toLowerCase().includes(s)
    || p.uid.toLowerCase().startsWith(s)
}

export type PeopleSort = 'recent' | 'created' | 'name'

export function sortPeople(people: AdminPerson[], by: PeopleSort): AdminPerson[] {
  const arr = [...people]
  const t = (s: string | null) => (s ? new Date(s).getTime() : 0)
  if (by === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  else if (by === 'created') arr.sort((a, b) => t(b.createdAt) - t(a.createdAt))
  else arr.sort((a, b) => Math.max(t(b.lastSignInAt), t(b.memos.lastAt)) - Math.max(t(a.lastSignInAt), t(a.memos.lastAt)))
  return arr
}

/** `{ tier: 'plus', fields: ['patientName'] }` → "tier: plus · fields: patientName". */
export function summarize(details: Record<string, unknown> | undefined): string {
  if (!details) return ''
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

/** window.prompt with the person's name typed back, for the destructive actions. */
export function confirmTyped(prompt: string, expected: string): boolean {
  const typed = window.prompt(`${prompt}\n\n계속하려면 "${expected}" 를 입력하세요.`)
  return typed !== null && typed.trim() === expected
}

// ── /admin?tab=…&uid=… ──────────────────────────────────────────────────────

export type AdminTab = 'overview' | 'parents' | 'children' | 'ai'
export const ADMIN_TABS: { key: AdminTab; label: string }[] = [
  { key: 'overview', label: '대시보드' },
  { key: 'parents', label: '부모님' },
  { key: 'children', label: '가족' },
  { key: 'ai', label: 'AI · 통계' },
]

export interface AdminRoute { tab: AdminTab; uid: string | null }

export function routeFromSearch(search: string): AdminRoute {
  const q = new URLSearchParams(search)
  const tab = q.get('tab') as AdminTab | null
  return {
    tab: tab && ADMIN_TABS.some((t) => t.key === tab) ? tab : 'overview',
    uid: q.get('uid'),
  }
}

export function searchFromRoute(r: AdminRoute): string {
  const q = new URLSearchParams()
  if (r.tab !== 'overview') q.set('tab', r.tab)
  if (r.uid) q.set('uid', r.uid)
  const s = q.toString()
  return s ? `?${s}` : ''
}
