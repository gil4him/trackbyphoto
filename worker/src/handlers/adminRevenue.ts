/**
 * adminRevenue — 운영실 매출 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D12). Read-only.
 * Every store purchase on file (planPayments), what the parent's plan says,
 * what RevenueCat says about each, and RevenueCat's own project overview.
 * Kept 5 minutes in memory; `refresh: true` skips that. The arithmetic is in
 * ../revenue.ts.
 *
 * Nothing here charges, renews or ends anything; handlers/subscriptions.ts
 * does that on its own clock.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { Caller } from '../context.js'
import { requireAdmin } from './admin.js'
import { getPlans } from '../plans.js'
import { fetchSubscriberJson, type LookupProblem } from '../payments/revenuecat.js'
import { overviewMetrics, priceFromLabel, storeDetail, subStatus, summarize, type OverviewMetric, type RevenueSummary, type SubRow } from '../revenue.js'
import { logger } from '../log.js'

const CACHE_MS = 5 * 60_000
const D = 86_400_000
const RC_V2 = 'https://api.revenuecat.com/v2/projects'
/** The v2 overview needs its own key (a v1 secret key is refused). */
export const OVERVIEW_ENV = ['REVENUECAT_V2_KEY', 'REVENUECAT_PROJECT_ID'] as const

type SourceState = 'ok' | 'unconfigured' | 'error'

export interface AdminRevenue {
  payments: { live: boolean; provider: string }
  /** The per-payer store lookups: ok, or why the rows are unconfirmed. */
  store: { state: SourceState; missing: string[]; error: string | null }
  rows: SubRow[]
  summary: RevenueSummary
  /** List price per paid tier (KRW, VAT included) from the plans table. */
  prices: Record<string, number | null>
  overview: { state: SourceState; missing: string[]; error: string | null; metrics: OverviewMetric[] }
  at: string
}

export interface RevenueDeps {
  lookup: (payerUid: string) => Promise<{ json: unknown } | LookupProblem>
  overview: () => Promise<{ json: unknown } | 'missing' | { error: string }>
  now: () => number
}

export function overviewMissing(): string[] {
  return OVERVIEW_ENV.filter((k) => !process.env[k])
}

async function fetchOverview(): Promise<{ json: unknown } | 'missing' | { error: string }> {
  if (overviewMissing().length) return 'missing'
  try {
    const res = await fetch(`${RC_V2}/${encodeURIComponent(process.env.REVENUECAT_PROJECT_ID!)}/metrics/overview`, {
      headers: { Authorization: `Bearer ${process.env.REVENUECAT_V2_KEY}` }, signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { error: `RevenueCat ${res.status}${res.status === 401 || res.status === 403 ? ' (v2 키에 charts_metrics 읽기 권한이 필요해요)' : ''}` }
    return { json: await res.json() }
  } catch (err) {
    return { error: String((err as Error).message ?? err).slice(0, 120) }
  }
}

export const defaultRevenueDeps: RevenueDeps = {
  lookup: (payerUid) => fetchSubscriberJson(payerUid),
  overview: fetchOverview,
  now: () => Date.now(),
}

let cache: { at: number; value: AdminRevenue } | null = null
export function resetRevenueCache() { cache = null }

const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

export async function adminRevenue(caller: Caller, data: { refresh?: unknown } = {}, deps: RevenueDeps = defaultRevenueDeps): Promise<AdminRevenue> {
  requireAdmin(caller)
  const now = deps.now()
  if (cache && data?.refresh !== true && now - cache.at < CACHE_MS) return cache.value

  const db = getFirestore()
  const [plans, paymentsSnap, endedSnap] = await Promise.all([
    getPlans(),
    db.collection('planPayments').get(),
    // Equality only (a range on timestamp too would need a composite index);
    // the 30-day window is cut in code, like the app's own plan-log read.
    db.collection('auditLogs').where('action', '==', 'plan.change').limit(1000).get(),
  ])
  const prices: Record<string, number | null> = {}
  for (const t of ['basic', 'plus', 'family']) prices[t] = priceFromLabel(plans?.[t as 'plus']?.priceLabel)

  // The store's word on each payer; one problem is enough to say the rows are unconfirmed.
  const store: AdminRevenue['store'] = { state: 'ok', missing: [], error: null }
  const rows: SubRow[] = []
  const docs = paymentsSnap.docs
  for (let i = 0; i < docs.length; i += 5) {
    const chunk = docs.slice(i, i + 5)
    const part = await Promise.all(chunk.map(async (d) => {
      const payerUid = d.id
      const patientUid = String(d.get('patientUid') ?? '')
      const tier = String(d.get('tier') ?? '')
      const productId = String(d.get('productId') ?? '')
      const user = patientUid ? (await db.doc(`users/${patientUid}`).get()).data() : undefined
      const plan = (user?.plan ?? {}) as { status?: unknown; since?: unknown }
      const found = await deps.lookup(payerUid)
      let detail = null
      if (found === 'missing-key') { store.state = 'unconfigured'; store.missing = ['REVENUECAT_SECRET_KEY'] }
      else if (found === 'unreachable') { if (store.state === 'ok') { store.state = 'error'; store.error = 'RevenueCat이 답하지 않았어요' } }
      else if (found === 'unknown-subscriber') { if (store.state === 'ok') { store.state = 'error'; store.error = `RevenueCat이 모르는 결제자가 있어요 (${payerUid.slice(0, 6)}…)` } }
      else detail = storeDetail(found.json, productId)
      const expiresAt = detail?.expiresMs ?? ms(d.get('expiresAt'))
      return {
        payerUid, patientUid, tier, productId,
        patientName: typeof user?.patientName === 'string' ? user.patientName : '',
        since: detail?.originalPurchaseMs ?? ms(plan.since) ?? ms(d.get('updatedAt')),
        expiresAt,
        status: subStatus(detail, plan.status, expiresAt, now),
        store: detail?.store ?? null,
        sandbox: detail?.sandbox ?? false,
        trial: detail?.periodType === 'trial',
        priceKRW: prices[tier] ?? null,
      } satisfies SubRow
    }))
    rows.push(...part)
  }
  rows.sort((a, b) => (b.since ?? 0) - (a.since ?? 0))

  // Purchases the poll already ended (back to Free) in the last 30 days.
  const endedLog = endedSnap.docs.flatMap((d) => {
    const det = (d.get('details') ?? {}) as Record<string, unknown>
    const at = ms(d.get('timestamp'))
    return det.source === 'subscription' && det.to === 'free' && at !== null && at >= now - 30 * D ? [{ atMs: at, refunded: det.refunded === true }] : []
  })

  const overview: AdminRevenue['overview'] = { state: 'ok', missing: [], error: null, metrics: [] }
  const ov = await deps.overview()
  if (ov === 'missing') { overview.state = 'unconfigured'; overview.missing = overviewMissing() }
  else if ('error' in ov) { overview.state = 'error'; overview.error = ov.error; logger.warn('[adminRevenue] overview failed', { err: ov.error }) }
  else {
    try { overview.metrics = overviewMetrics(ov.json) } catch (err) { overview.state = 'error'; overview.error = (err as Error).message }
  }

  const value: AdminRevenue = {
    payments: { live: plans?.flags?.payments === true, provider: process.env.PAYMENT_PROVIDER || 'stub' },
    store, rows, summary: summarize(rows, endedLog, now), prices, overview,
    at: new Date(now).toISOString(),
  }
  cache = { at: now, value }
  return value
}
