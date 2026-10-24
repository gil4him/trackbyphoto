// 운영실 매출 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D5). Payments are not live,
// so revenue is a calculator: the owner's price and paying-family numbers
// (saved in admin_config/dashboard.revenue) give the month's revenue, then
// VAT, the store fee and the month's costs come off it. The plan mix and the
// upgrades are real. Pure, so the arithmetic is tested on its own.
//
// TODO(payments): once payments are live (D12), the same cards take real MRR
// from the stores instead of `revenue()` over the assumptions.

import type { Plans, PlanTier } from '../types'
import { TIERS } from './plan'
import type { AdminPerson } from './admin'

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
export function revenue(a: RevenueAssumptions, costKRW: number | null): Waterfall {
  const gross = (Object.keys(a.prices) as PlanTier[]).reduce((sum, t) => sum + (a.prices[t] ?? 0) * (a.families[t] ?? 0), 0)
  const vat = gross / 11
  const fee = (gross - vat) * STORE_FEE
  return { gross, vat, fee, cost: costKRW, net: gross - vat - fee - (costKRW ?? 0) }
}

const RANK: Record<string, number> = { free: 0, basic: 1, plus: 2, family: 3 }

/** plan.change rows (auditLogs) in the window that moved to a bigger plan. */
export function upgrades(rows: { details?: Record<string, unknown>; timestampMs: number | null }[], sinceMs: number): number {
  return rows.filter((r) => (r.timestampMs ?? 0) >= sinceMs
    && (RANK[String(r.details?.to)] ?? -1) > (RANK[String(r.details?.from ?? 'free')] ?? 0)).length
}

export const won = (n: number) => `${n < 0 ? '−' : ''}₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`
