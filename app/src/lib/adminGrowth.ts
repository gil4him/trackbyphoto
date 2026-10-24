// 운영실 성장 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D3): the worker's numbers
// (worker/src/adminGrowth.ts) and the small arithmetic the screen needs.

import { callWorker } from './worker'

export interface FunnelStage { key: string; label: string; count: number; rate: number | null }
export interface CohortRow { week: string; size: number; pct: (number | null)[] }
export interface AdminGrowth {
  funnel: FunnelStage[]
  drop: { from: string; to: string; lost: number; of: number; dropPct: number; text: string } | null
  cohorts: CohortRow[]
  sources: { invite: number; direct: number; none: number; total: number }
  trend: { dates: string[]; activeParents: number[]; families: number[] }
  at: string
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
