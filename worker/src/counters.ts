import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// ────────────────────────────────────────────────────────────────────────────
// Admin dashboard counters.
//
// Every successful memo bumps two atomic Firestore counters:
//   admin_totals/global             — ever-growing roll-up across the app
//   admin_daily/{YYYY-MM-DD}        — one doc per UTC day for the trend chart
//
// Both are written via FieldValue.increment so concurrent uploads from
// multiple devices don't race. The /superadmin page reads these and the
// recent memos collection to render the dashboard.
// ────────────────────────────────────────────────────────────────────────────

function utcDateKey(d: Date): string {
  // YYYY-MM-DD in UTC. We want the dashboard "today" to mean "today on the
  // server" so the doc id is stable regardless of which timezone runs the
  // worker.
  return d.toISOString().slice(0, 10)
}

export async function bumpAdminCounters(args: {
  category: string
  memoSource: string
  model: string | null
  // Named for the original Gemini tier; the gemini* counter fields are kept
  // so historical dashboard data stays continuous. Local models record USD 0.
  geminiCost: { promptTokens: number; outputTokens: number; totalUSD: number } | null
}) {
  const db = getFirestore()
  const day = utcDateKey(new Date())
  const inc = (n: number) => FieldValue.increment(n)
  const safeKey = (s: string) => s.replace(/[.~/[\]#\s:]/g, '_') || 'unknown'
  const cat = safeKey(args.category)
  const src = safeKey(args.memoSource)
  const cost = args.geminiCost

  // Nested objects, NOT 'byCategory.x' keys: set() treats a dotted key as one
  // literal field name (only update() expands paths), which is why the old
  // Cloud Function's breakdowns landed in fields like "bySource.cloud-vision"
  // that the dashboard never read. set({merge:true}) deep-merges these maps.
  const totalsUpdate: Record<string, unknown> = {
    memos: inc(1),
    byCategory: { [cat]: inc(1) },
    bySource: { [src]: inc(1) },
    lastMemoAt: FieldValue.serverTimestamp(),
  }
  const dailyUpdate: Record<string, unknown> = {
    date: day,
    memos: inc(1),
    byCategory: { [cat]: inc(1) },
    bySource: { [src]: inc(1) },
  }
  if (cost) {
    totalsUpdate.geminiCalls = inc(1)
    totalsUpdate.geminiPromptTokens = inc(cost.promptTokens)
    totalsUpdate.geminiOutputTokens = inc(cost.outputTokens)
    totalsUpdate.geminiUSD = inc(cost.totalUSD)
    dailyUpdate.geminiCalls = inc(1)
    dailyUpdate.geminiPromptTokens = inc(cost.promptTokens)
    dailyUpdate.geminiOutputTokens = inc(cost.outputTokens)
    dailyUpdate.geminiUSD = inc(cost.totalUSD)
    // Per-model breakdown so the dashboard can show contribution per model
    // when MODEL has been flipped mid-month (e.g., gemini-2.5-flash → gpt-4o
    // for A/B). Model dots/colons are escaped in safeKey.
    if (args.model) {
      const mdl = safeKey(args.model)
      totalsUpdate.byModel = { [mdl]: { calls: inc(1), usd: inc(cost.totalUSD) } }
      dailyUpdate.byModel = { [mdl]: { calls: inc(1), usd: inc(cost.totalUSD) } }
    }
  }

  // set({merge:true}) so the docs are created on first run without a
  // separate initialization step.
  await Promise.all([
    db.collection('admin_totals').doc('global').set(totalsUpdate, { merge: true }),
    db.collection('admin_daily').doc(day).set(dailyUpdate, { merge: true }),
  ])
}
