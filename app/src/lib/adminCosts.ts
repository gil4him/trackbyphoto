// 운영실 비용 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D6): what a month costs.
// AI memos are real (admin_daily.geminiUSD, written by the worker); the
// Firebase bill and the fixed costs are entered by the owner and kept in
// admin_config/dashboard (costs[YYYY-MM], fixed, fx). Pure, so tested alone.

/** ₩ per $ until the owner sets one. */
export const DEFAULT_FX = 1400
/** A month's Firebase budget until the owner sets one ($). */
export const DEFAULT_BUDGET_USD = 5

export interface CostEntry {
  firebaseUSD: number | null
  budgetUSD: number
  /** Optional split of the Firebase bill. */
  parts: { storage: number | null; firestore: number | null; hosting: number | null; other: number | null }
}

export interface FixedCost {
  id: string
  label: string
  /** null: not entered yet. */
  amount: number | null
  currency: 'USD' | 'KRW'
  period: 'year' | 'month' | 'once'
}

/** The fixed costs the spec names; Mac mini 전기 waits for the owner's number. */
export const DEFAULT_FIXED: FixedCost[] = [
  { id: 'apple', label: 'Apple 개발자', amount: 99, currency: 'USD', period: 'year' },
  { id: 'play', label: 'Google Play', amount: 25, currency: 'USD', period: 'once' },
  { id: 'power', label: 'Mac mini 전기', amount: null, currency: 'KRW', period: 'month' },
]

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

export function fxOf(dashboard: Record<string, unknown> | null | undefined): number {
  const v = num(dashboard?.fx)
  return v && v > 0 ? v : DEFAULT_FX
}

export function entryOf(dashboard: Record<string, unknown> | null | undefined, month: string): CostEntry {
  const e = ((dashboard?.costs ?? {}) as Record<string, Record<string, unknown>>)[month] ?? {}
  return {
    firebaseUSD: num(e.firebaseUSD),
    budgetUSD: num(e.budgetUSD) ?? num(dashboard?.budgetUSD) ?? DEFAULT_BUDGET_USD,
    parts: { storage: num(e.storageUSD), firestore: num(e.firestoreUSD), hosting: num(e.hostingUSD), other: num(e.otherUSD) },
  }
}

export function fixedOf(dashboard: Record<string, unknown> | null | undefined): FixedCost[] {
  const saved = dashboard?.fixed
  if (!Array.isArray(saved)) return DEFAULT_FIXED
  return saved.flatMap((f) => {
    const x = f as Record<string, unknown>
    if (typeof x?.id !== 'string' || typeof x.label !== 'string') return []
    const currency = x.currency === 'KRW' ? 'KRW' : 'USD'
    const period = x.period === 'month' || x.period === 'once' ? x.period : 'year'
    return [{ id: x.id, label: x.label, amount: num(x.amount), currency, period } as FixedCost]
  })
}

/** One fixed cost per month in ₩: a year's ÷12, a one-off 0; null if not entered. */
export function monthlyKRW(f: FixedCost, fx: number): number | null {
  if (f.amount === null) return null
  if (f.period === 'once') return 0
  const krw = f.currency === 'USD' ? f.amount * fx : f.amount
  return Math.round(f.period === 'year' ? krw / 12 : krw)
}

export interface CostSummary {
  fx: number
  entry: CostEntry
  aiUSD: number
  firebaseKRW: number | null
  aiKRW: number
  fixed: (FixedCost & { monthlyKRW: number | null })[]
  /** What is known, in ₩ a month. */
  totalKRW: number
  /** What is not entered yet, by name (the total leaves it out). */
  missing: string[]
}

export function costSummary(dashboard: Record<string, unknown> | null | undefined, month: string, aiUSD: number): CostSummary {
  const fx = fxOf(dashboard)
  const entry = entryOf(dashboard, month)
  const fixed = fixedOf(dashboard).map((f) => ({ ...f, monthlyKRW: monthlyKRW(f, fx) }))
  const firebaseKRW = entry.firebaseUSD === null ? null : Math.round(entry.firebaseUSD * fx)
  const aiKRW = Math.round(aiUSD * fx)
  const missing = [...(firebaseKRW === null ? ['Firebase'] : []), ...fixed.filter((f) => f.monthlyKRW === null).map((f) => f.label)]
  const totalKRW = (firebaseKRW ?? 0) + aiKRW + fixed.reduce((s, f) => s + (f.monthlyKRW ?? 0), 0)
  return { fx, entry, aiUSD, firebaseKRW, aiKRW, fixed, totalKRW, missing }
}

/** A month's cost per family, or null with no family yet. */
export const perFamily = (totalKRW: number, families: number): number | null => (families > 0 ? Math.round(totalKRW / families) : null)

/** admin_daily is kept per UTC day: the days of `month`, as ids to read. */
export function monthDays(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-31` }
}

/** Share of the budget, for the meter (0–100+, capped by the caller). */
export const budgetShare = (usd: number, budget: number) => (budget > 0 ? Math.round((usd / budget) * 100) : 0)

export const usd = (n: number) => `$${n.toFixed(2)}`

/** YYYY-MM in Seoul. */
export const seoulMonth = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(now)
