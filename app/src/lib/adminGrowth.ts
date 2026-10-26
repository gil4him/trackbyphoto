// 운영실 성장 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D3): the worker's numbers
// (worker/src/adminGrowth.ts) and the small arithmetic the screen needs.

import { callWorker } from './worker'

export interface FunnelStage { key: string; label: string; count: number; rate: number | null }
export interface CohortRow { week: string; size: number; pct: (number | null)[] }
/** One store's installs over the last 30 days (worker/src/traffic). */
export interface StoreInstalls {
  state: 'ok' | 'unconfigured' | 'error'
  missing: string[]
  error: string | null
  days: { date: string; n: number | null }[]
  total: number
  known: number
}
export interface OriginRow { key: string; label: string; count: number }
export interface AdminGrowth {
  funnel: FunnelStage[]
  drop: { from: string; to: string; lost: number; of: number; dropPct: number; text: string } | null
  cohorts: CohortRow[]
  sources: { invite: number; direct: number; none: number; total: number }
  origins: { rows: OriginRow[]; total: number }
  installs: { ios: StoreInstalls; android: StoreInstalls }
  trend: { dates: string[]; activeParents: number[]; families: number[] }
  at: string
}

/** The 설치 row: installs over the stores that are connected, null while none is. */
export function installTotal(i: AdminGrowth['installs'] | undefined): number | null {
  if (!i) return null
  const on = [i.ios, i.android].filter((s) => s.state === 'ok' && s.known > 0)
  return on.length ? on.reduce((sum, s) => sum + s.total, 0) : null
}

/** How one store reads on the screen: a number, 연결 필요 (with what is missing), an error, or no report yet. */
export function storeState(s: StoreInstalls): { kind: 'num' | 'need' | 'bad' | 'none'; detail: string } {
  if (s.state === 'unconfigured') return { kind: 'need', detail: s.missing.join(', ') }
  if (s.state === 'error') return { kind: 'bad', detail: s.error ?? '' }
  if (s.known === 0) return { kind: 'none', detail: '' }
  return { kind: 'num', detail: s.known === s.days.length ? '' : `${s.known}일치` }
}

/** 가입 ÷ 설치 as "→ 72%", or '' when the stores are not connected. */
export function installRate(signups: number, total: number | null): string {
  return total ? `→ ${Math.round((signups / total) * 100)}%` : ''
}

export const adminGrowth = (refresh = false) =>
  callWorker<AdminGrowth>('adminGrowth', refresh ? { refresh: true } : {}, { timeoutMs: 90_000 })

/** 2026-09-21 → "9/21 주". */
export function weekLabel(week: string): string {
  const [, m, d] = week.split('-').map(Number)
  return `${m}/${d} 주`
}

/** 2026-10-23 → "10월 23일". */
export function dayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}월 ${d}일`
}

/** A round top for the y axis and its four steps (0 included). */
export function yTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw)!
  const steps = Math.ceil(max / step)
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(i * step * 100) / 100)
}

/** Four evenly spread indexes into a series of `n` (first and last included). */
export function fourMarks(n: number): number[] {
  if (n <= 1) return [0]
  return [...new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1])]
}

/** The stage the bar is drawn against: the first stage's count. */
export function barWidth(count: number, first: number): number {
  return first ? Math.max(count ? 14 : 0, Math.round((count / first) * 100)) : 0
}
