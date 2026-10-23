// 100 made-up store purchases, App Store and Play mixed, pushed through the
// worker's RevenueCat check (revenueCatPayments / lookupSubscriber) at once.
// No store and no RevenueCat is called: a fake RevenueCat answers in-process
// with the subscriber JSON each store produces (Play names its products
// `id:basePlan`, the App Store the bare id), after a random delay.
// Real store purchases need a phone and a sandbox tester; this checks
// everything after that point.
//   npm run payments-sim -- [--count 100] [--within 10] [--seed 42]
import { PRODUCT_IDS, lookupSubscriber, revenueCatPayments, type PaidTier } from '../payments/revenuecat.js'

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const COUNT = arg('count', 100)
const WITHIN_MS = arg('within', 10) * 1000
let seed = arg('seed', Date.now() % 100_000)
const SEED = seed
/** Small seeded PRNG, so a failing run can be repeated with --seed. */
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31)
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]

type Store = 'app_store' | 'play_store'
type Scenario = 'bought' | 'billing-grace' | 'refunded' | 'expired' | 'other-tier' | 'never-bought' | 'outage' | 'to-free'
const SCENARIOS: readonly Scenario[] = ['bought', 'bought', 'bought', 'billing-grace', 'refunded', 'expired', 'other-tier', 'never-bought', 'outage', 'to-free']

interface Txn {
  n: number
  uid: string
  store: Store
  tier: PaidTier
  scenario: Scenario
  /** What the store product is called in RevenueCat for this store. */
  productId: string
  expect: { ok: boolean; reason?: string }
}

const productFor = (store: Store, tier: PaidTier) => (store === 'play_store' ? `${PRODUCT_IDS[tier]}:monthly` : PRODUCT_IDS[tier])
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
const DAY = 86_400_000

/** RevenueCat's v1 subscriber JSON for one payer, as this store would leave it. */
function subscriberJson(t: Txn) {
  const tier: PaidTier = t.scenario === 'other-tier' ? (t.tier === 'plus' ? 'family' : 'plus') : t.tier
  const productId = productFor(t.store, tier)
  const expires = t.scenario === 'expired' ? iso(-2 * DAY) : iso(30 * DAY)
  // Play subscriptions show up keyed either way; the worker must find both.
  const subKey = t.store === 'play_store' && rand() < 0.5 ? productId.split(':')[0] : productId
  return {
    subscriber: {
      original_app_user_id: t.uid,
      entitlements: {
        [tier]: {
          product_identifier: productId,
          expires_date: expires,
          grace_period_expires_date: t.scenario === 'billing-grace' ? iso(16 * DAY) : null,
          purchase_date: iso(-DAY),
        },
      },
      subscriptions: {
        [subKey]: {
          store: t.store,
          is_sandbox: true,
          expires_date: expires,
          purchase_date: iso(-DAY),
          period_type: 'normal',
          billing_issues_detected_at: t.scenario === 'billing-grace' ? iso(-DAY / 2) : null,
          refunded_at: t.scenario === 'refunded' ? iso(-DAY / 4) : null,
          unsubscribe_detected_at: null,
        },
      },
    },
  }
}

const txns: Txn[] = Array.from({ length: COUNT }, (_, n) => {
  const store: Store = n % 2 === 0 ? 'app_store' : 'play_store'
  const tier = pick(['plus', 'family'] as const)
  const scenario = pick(SCENARIOS)
  const expect =
    scenario === 'bought' || scenario === 'billing-grace' || scenario === 'to-free'
      ? { ok: true }
      : scenario === 'outage'
        ? { ok: false, reason: 'the store could not be reached' }
        : { ok: false, reason: 'not entitled' }
  return { n, uid: `sim-${SEED}-${n}`, store, tier, scenario, productId: productFor(store, tier), expect }
})
const byUid = new Map(txns.map((t) => [t.uid, t]))

/** Stands in for api.revenuecat.com: 50–800 ms, then the answer for that payer. */
let calls = 0
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  calls++
  const auth = new Headers(init?.headers).get('Authorization')
  if (auth !== 'Bearer sk_simulated') return new Response('{"message":"bad key"}', { status: 401 })
  const uid = decodeURIComponent(String(input).split('/').pop() ?? '')
  await new Promise((r) => setTimeout(r, 50 + rand() * 750))
  const t = byUid.get(uid)
  if (!t) return new Response('{}', { status: 500 })
  if (t.scenario === 'outage') return new Response('{"message":"upstream"}', { status: 503 })
  if (t.scenario === 'never-bought') return new Response('{"message":"not found"}', { status: 404 })
  return new Response(JSON.stringify(subscriberJson(t)), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

process.env.REVENUECAT_SECRET_KEY = 'sk_simulated'
const provider = revenueCatPayments(fakeFetch)

interface Outcome { t: Txn; pass: boolean; got: string; ms: number }

async function run(t: Txn, startAt: number): Promise<Outcome> {
  await new Promise((r) => setTimeout(r, startAt))
  const began = Date.now()
  const res = await provider.confirm({
    payerUid: t.uid,
    patientUid: `elder-${t.n}`,
    from: 'free',
    to: t.scenario === 'to-free' ? 'free' : t.tier,
    // The app's token is never believed; a forged one must change nothing.
    token: rand() < 0.3 ? 'forged-receipt' : 'rc-checkout',
  })
  let pass = res.ok === t.expect.ok && (res.ok || res.reason === t.expect.reason)
  if (res.ok && t.scenario !== 'to-free') pass &&= res.productId === t.productId && res.expiresAt instanceof Date
  // The renewal poll's path: an outage must read as "no answer", never as "cancelled".
  if (t.scenario === 'outage') pass &&= (await lookupSubscriber(t.uid, fakeFetch)) === null
  if (t.scenario === 'bought') pass &&= !!(await lookupSubscriber(t.uid, fakeFetch))?.entitlements[t.tier]
  const got = res.ok ? `ok ${res.productId ?? '(free)'}` : `refused: ${res.reason}`
  return { t, pass, got, ms: Date.now() - began }
}

// Start times spread over the first fifth of the window so all of them
// overlap and the slowest still has to land inside it.
const spread = Math.min(2000, WITHIN_MS / 5)
const t0 = Date.now()
const deadline = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), WITHIN_MS))
const done = await Promise.race([Promise.all(txns.map((t) => run(t, rand() * spread))), deadline])
const wall = Date.now() - t0

if (done === 'timeout') {
  console.log(`❌ not all ${COUNT} transactions finished within ${WITHIN_MS / 1000}s (seed ${SEED})`)
  process.exit(1)
}

const rows = done
const failed = rows.filter((r) => !r.pass)
const line = (label: string, xs: Outcome[]) => `${label.padEnd(12)} ${String(xs.filter((r) => r.pass).length).padStart(3)}/${String(xs.length).padEnd(3)}`
console.log(`payments simulation · seed ${SEED} · ${COUNT} transactions · ${calls} RevenueCat calls (faked) · ${wall} ms wall\n`)
for (const store of ['app_store', 'play_store'] as const) {
  const mine = rows.filter((r) => r.t.store === store)
  const counts = SCENARIOS.filter((s, i) => SCENARIOS.indexOf(s) === i)
    .map((s) => `${s} ${mine.filter((r) => r.t.scenario === s && r.pass).length}/${mine.filter((r) => r.t.scenario === s).length}`)
    .join(' · ')
  console.log(`${line(store, mine)} ${counts}`)
}
const slowest = Math.max(...rows.map((r) => r.ms))
console.log(`\nslowest check ${slowest} ms · all done in ${(wall / 1000).toFixed(1)}s (limit ${WITHIN_MS / 1000}s)`)
for (const r of failed) {
  console.log(`  ✗ #${r.t.n} ${r.t.store} ${r.t.tier} ${r.t.scenario}: expected ${r.t.expect.ok ? 'ok' : r.t.expect.reason}, got ${r.got}`)
}
console.log(failed.length ? `\n❌ ${failed.length} failed` : `\n✅ all ${COUNT} passed`)
process.exit(failed.length ? 1 : 0)
