/**
 * 운영실 매출 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D12): what the store
 * subscriptions really are, on plain rows.
 *
 * Two sources, both read-only:
 *   - our own records: planPayments/{payerUid} (one store purchase per payer)
 *     and the parent's users.plan it pays for;
 *   - RevenueCat: the v1 subscriber answer per payer tells the store, sandbox,
 *     cancellation, card trouble and refunds; the v2 project overview gives
 *     RevenueCat's own MRR / active subscriptions / 28-day revenue.
 *
 * Money here is the list price in KRW from the plans table (what a family in
 * Korea pays, VAT included); the stores settle in each country's price, and
 * RevenueCat's overview is the figure to trust for that. Nothing is estimated:
 * a row the store has not confirmed says so.
 */

/** What RevenueCat says about the subscription behind one purchase. */
export interface StoreDetail {
  store: 'app_store' | 'play_store' | 'other'
  sandbox: boolean
  /** trial / intro / normal, as RevenueCat names the period. */
  periodType: string | null
  purchaseMs: number | null
  originalPurchaseMs: number | null
  expiresMs: number | null
  unsubscribedMs: number | null
  billingIssueMs: number | null
  graceUntilMs: number | null
  refundedMs: number | null
}

const ms = (iso: unknown): number | null => {
  if (typeof iso !== 'string') return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** The subscription that granted a product, out of RevenueCat's v1 subscriber JSON. */
export function storeDetail(json: unknown, productId: string): StoreDetail | null {
  const subs = (json as { subscriber?: { subscriptions?: Record<string, Record<string, unknown>> } })?.subscriber?.subscriptions
  // Play products can be keyed `id:basePlan`; our rows carry the bare id or the full one.
  const sub = subs?.[productId] ?? subs?.[productId.split(':')[0]]
    ?? Object.entries(subs ?? {}).find(([k]) => k.split(':')[0] === productId.split(':')[0])?.[1]
  if (!sub) return null
  const store = sub.store === 'app_store' || sub.store === 'play_store' ? sub.store : 'other'
  return {
    store,
    sandbox: sub.is_sandbox === true,
    periodType: typeof sub.period_type === 'string' ? sub.period_type : null,
    purchaseMs: ms(sub.purchase_date),
    originalPurchaseMs: ms(sub.original_purchase_date),
    expiresMs: ms(sub.expires_date),
    unsubscribedMs: ms(sub.unsubscribe_detected_at),
    billingIssueMs: ms(sub.billing_issues_detected_at),
    graceUntilMs: ms(sub.grace_period_expires_date),
    refundedMs: ms(sub.refunded_at),
  }
}

export type SubStatus = 'active' | 'grace' | 'cancelling' | 'ended' | 'refunded'

/** One purchase as the screen shows it. */
export interface SubRow {
  payerUid: string
  patientUid: string
  patientName: string
  tier: string
  productId: string
  /** What we recorded when the purchase went through. */
  since: number | null
  expiresAt: number | null
  status: SubStatus
  /** Null until RevenueCat confirmed the row (no key, or no answer). */
  store: StoreDetail['store'] | null
  sandbox: boolean
  trial: boolean
  /** The list price counted in MRR; null while the plans table has none. */
  priceKRW: number | null
}

/** The status from what RevenueCat said, or from our own plan record when it said nothing. */
export function subStatus(detail: StoreDetail | null, ownStatus: unknown, expiresAt: number | null, now: number): SubStatus {
  if (!detail) {
    if (expiresAt !== null && expiresAt < now) return 'ended'
    return ownStatus === 'grace' ? 'grace' : 'active'
  }
  if (detail.refundedMs !== null) return 'refunded'
  const live = detail.expiresMs === null || detail.expiresMs > now
  if (!live) return detail.graceUntilMs !== null && detail.graceUntilMs > now ? 'grace' : 'ended'
  if (detail.billingIssueMs !== null) return 'grace'
  if (detail.unsubscribedMs !== null) return 'cancelling'
  return 'active'
}

/** "₩4,400/월" → 4400. */
export function priceFromLabel(label: unknown): number | null {
  const m = typeof label === 'string' ? label.match(/₩\s*([\d,]+)/) : null
  return m ? Number(m[1].replace(/,/g, '')) : null
}

export interface RevenueSummary {
  /** Rows the family is paying for right now (active, grace, cancelling), store builds left out. */
  paying: number
  byTier: Record<string, number>
  grace: number
  cancelling: number
  sandbox: number
  trial: number
  /** Purchases that began in the last 30 days. */
  new30d: number
  ended30d: number
  refunded30d: number
  /** Monthly list price of what is paid for, in KRW; null when a paid row has no price. */
  mrrKRW: number | null
  /** Rows whose store answer is still missing. */
  unverified: number
}

const PAYING: SubStatus[] = ['active', 'grace', 'cancelling']
const D = 86_400_000

/** The counts over the rows, plus what the log says ended. */
export function summarize(rows: SubRow[], endedLog: { atMs: number; refunded: boolean }[], now: number): RevenueSummary {
  const out: RevenueSummary = { paying: 0, byTier: {}, grace: 0, cancelling: 0, sandbox: 0, trial: 0, new30d: 0, ended30d: 0, refunded30d: 0, mrrKRW: 0, unverified: 0 }
  let priceless = false
  for (const r of rows) {
    if (r.store === null) out.unverified++
    if (r.sandbox) { out.sandbox++; continue }
    if (!PAYING.includes(r.status)) continue
    out.paying++
    out.byTier[r.tier] = (out.byTier[r.tier] ?? 0) + 1
    if (r.status === 'grace') out.grace++
    if (r.status === 'cancelling') out.cancelling++
    if (r.trial) out.trial++
    if (r.since !== null && r.since >= now - 30 * D) out.new30d++
    if (r.priceKRW === null) priceless = true
    else if (!r.trial) out.mrrKRW! += r.priceKRW
  }
  for (const r of rows) if (!r.sandbox && (r.status === 'refunded' || r.status === 'ended')) {
    // Still on file (the poll has not cleared it yet): counts like a log row of today.
    if (r.status === 'refunded') out.refunded30d++
    else out.ended30d++
  }
  for (const e of endedLog) if (e.atMs >= now - 30 * D) { if (e.refunded) out.refunded30d++; else out.ended30d++ }
  if (priceless) out.mrrKRW = null
  return out
}

/** One figure from RevenueCat's project overview (v2). */
export interface OverviewMetric { id: string; name: string; value: number; unit: string; period: string | null }

/** RevenueCat's v2 `GET /projects/{id}/metrics/overview`, kept as it comes. */
export function overviewMetrics(json: unknown): OverviewMetric[] {
  const list = (json as { metrics?: unknown })?.metrics
  if (!Array.isArray(list)) throw new Error('not a RevenueCat overview')
  return list.flatMap((m: Record<string, unknown>) => {
    if (typeof m?.id !== 'string' || typeof m.value !== 'number') return []
    return [{ id: m.id, name: typeof m.name === 'string' ? m.name : m.id, value: m.value, unit: typeof m.unit === 'string' ? m.unit : '', period: typeof m.period === 'string' ? m.period : null }]
  })
}
