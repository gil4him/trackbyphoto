// 운영실 매출 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D5). Payments are not live,
// so revenue is a calculator: the owner's price and paying-family numbers
// (saved in admin_config/dashboard.revenue) give the month's revenue, then
// VAT, the store fee and the month's costs come off it. The plan mix and the
// upgrades are real. Pure, so the arithmetic is tested on its own.
//
// With payments live (D12) the worker's adminRevenue brings the real rows:
// every store purchase, what RevenueCat says about it, and the list-price MRR;
// the calculator stays underneath as a what-if.

import type { Plans, PlanTier } from '../types'
import { TIERS } from './plan'
import type { AdminPerson } from './admin'
import { callWorker } from './worker'

export type SubStatus = 'active' | 'grace' | 'cancelling' | 'ended' | 'refunded'
export interface SubRow {
  payerUid: string
  patientUid: string
  patientName: string
  tier: string
  productId: string
  since: number | null
  expiresAt: number | null
  status: SubStatus
  /** Null until RevenueCat confirmed the row. */
  store: 'app_store' | 'play_store' | 'other' | null
  sandbox: boolean
  trial: boolean
  priceKRW: number | null
}
export interface RevenueSummary {
  paying: number
  byTier: Record<string, number>
  grace: number
  cancelling: number
  sandbox: number
  trial: number
  new30d: number
  ended30d: number
  refunded30d: number
  mrrKRW: number | null
  unverified: number
}
export interface OverviewMetric { id: string; name: string; value: number; unit: string; period: string | null }
type SourceState = 'ok' | 'unconfigured' | 'error'
export interface AdminRevenue {
  payments: { live: boolean; provider: string }
  store: { state: SourceState; missing: string[]; error: string | null }
  rows: SubRow[]
  summary: RevenueSummary
  prices: Record<string, number | null>
  overview: { state: SourceState; missing: string[]; error: string | null; metrics: OverviewMetric[] }
  at: string
}

export const adminRevenue = (refresh = false) =>
  callWorker<AdminRevenue>('adminRevenue', refresh ? { refresh: true } : {}, { timeoutMs: 60_000 })

export const STATUS_KO: Record<SubStatus, string> = { active: '결제 중', grace: '결제 문제', cancelling: '해지 예정', ended: '끝남', refunded: '환불' }
export const STORE_KO = { app_store: 'App Store', play_store: 'Google Play', other: '기타' } as const

/** The RevenueCat overview figures the screen names, in its order; the rest follow as they come. */
export const OVERVIEW_KO: Record<string, string> = {
  mrr: 'MRR', active_subscriptions: '활성 구독', revenue: '28일 매출', new_customers: '신규 고객 (28일)', active_trials: '체험 중', active_users: '활성 사용자 (28일)',
}
export function overviewRows(metrics: OverviewMetric[]): { id: string; label: string; text: string }[] {
  const known = Object.keys(OVERVIEW_KO)
  const sorted = [...metrics].sort((a, b) => (known.indexOf(a.id) + 1 || 99) - (known.indexOf(b.id) + 1 || 99))
  return sorted.map((m) => ({ id: m.id, label: OVERVIEW_KO[m.id] ?? m.name, text: metricText(m) }))
}
/** "$12.50", "3", "₩4,400". */
export function metricText(m: OverviewMetric): string {
  if (m.unit === '$' || m.unit === 'USD') return `$${m.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (m.unit === '₩' || m.unit === 'KRW') return won(m.value)
  if (m.unit === '#' || m.unit === '') return m.value.toLocaleString('ko-KR')
  return `${m.value.toLocaleString('ko-KR')} ${m.unit}`
}

/** 2026-11-20 as "11월 20일"; '' with no date. */
export function dayText(ms: number | null): string {
  if (ms === null) return ''
  const d = new Date(ms)
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(d)
}

/** Apple and Google take 15% from a small business's subscriptions. */
export const STORE_FEE = 0.15

/** Parents per plan; a parent never put on one is Free. */
export function planMix(people: AdminPerson[]): Record<PlanTier, number> {
  const mix: Record<PlanTier, number> = { free: 0, basic: 0, plus: 0, family: 0 }
  for (const p of people) if (p.kind === 'parent') mix[p.plan.explicit ? p.plan.tier : 'free']++
  return mix
}

/** The paid plans the plans table offers, lowest first. */
export function paidTiers(plans: Plans | null): PlanTier[] {
  const listed = TIERS.filter((t) => t !== 'free' && !!plans?.[t])
  return listed.length ? listed : ['plus', 'family']
}

/** "₩4,400/월" → 4400; null when the label has no price. */
export function priceFromLabel(label: string | undefined): number | null {
  const m = label?.match(/₩\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

export interface RevenueAssumptions {
  prices: Partial<Record<PlanTier, number>>
  families: Partial<Record<PlanTier, number>>
}

/** What the calculator starts from: the saved numbers, else the plans table's
 *  prices and today's real paying families. Never a made-up number. */
export function startingAssumptions(saved: unknown, plans: Plans | null, mix: Record<PlanTier, number>): RevenueAssumptions {
  const s = (saved ?? {}) as { prices?: Record<string, unknown>; families?: Record<string, unknown> }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const out: RevenueAssumptions = { prices: {}, families: {} }
  for (const t of paidTiers(plans)) {
    out.prices[t] = num(s.prices?.[t]) ?? priceFromLabel(plans?.[t]?.priceLabel) ?? 0
    out.families[t] = num(s.families?.[t]) ?? mix[t]
  }
  return out
}

export interface Waterfall {
  gross: number
  vat: number
  fee: number
  /** null: the month's costs were not entered. */
  cost: number | null
  net: number
}

/** Prices include VAT (÷11); the store fee is on the rest; then the costs. */
export function waterfall(gross: number, costKRW: number | null): Waterfall {
  const vat = gross / 11
  const fee = (gross - vat) * STORE_FEE
  return { gross, vat, fee, cost: costKRW, net: gross - vat - fee - (costKRW ?? 0) }
}

/** The calculator: the assumptions' prices × families, then the same waterfall. */
export function revenue(a: RevenueAssumptions, costKRW: number | null): Waterfall {
  return waterfall((Object.keys(a.prices) as PlanTier[]).reduce((sum, t) => sum + (a.prices[t] ?? 0) * (a.families[t] ?? 0), 0), costKRW)
}

const RANK: Record<string, number> = { free: 0, basic: 1, plus: 2, family: 3 }

/** plan.change rows (auditLogs) in the window that moved to a bigger plan. */
export function upgrades(rows: { details?: Record<string, unknown>; timestampMs: number | null }[], sinceMs: number): number {
  return rows.filter((r) => (r.timestampMs ?? 0) >= sinceMs
    && (RANK[String(r.details?.to)] ?? -1) > (RANK[String(r.details?.from ?? 'free')] ?? 0)).length
}

export const won = (n: number) => `${n < 0 ? '−' : ''}₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`
