import { useEffect, useState } from 'react'
import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase'
import { fmtDate, fmtTime } from '../util'
import type { Memo, MemoSource } from '../types'

interface RegenResult {
  memoId: string
  old: { activity: string; memo: string; scene: string; memoSource: string; model: string }
  new: { activity: string; memo: string; scene: string; model: string }
  cost: { promptTokens: number; outputTokens: number; totalUSD: number }
}

interface BackfillResult {
  scanned: number
  migrated: number
  alreadyOk: number
  skippedNoUid: number
}

interface BackfillMemoResult {
  scanned: number
  migrated: number
  alreadyOk: number
  skippedEmpty: number
}

/** Single source of truth for the admin email. Mirrored in firestore.rules. */
export const ADMIN_EMAIL = 'zymer4him@gmail.com'

/** Models supported by the cloud function. Must stay in sync with the
 *  PRICING table in functions/src/index.ts. The dashboard picker only lists
 *  these. Prices are USD per 1M tokens; for the per-call estimate we use
 *  ~1k input + ~150 output as a typical photo-memo shape. */
export const MODELS: { id: string; label: string; provider: 'Gemini' | 'OpenAI'; inPerM: number; outPerM: number }[] = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (균형, 추천)',          provider: 'Gemini', inPerM: 0.30, outPerM: 2.50 },
  { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro (최고 품질, 비쌈)',       provider: 'Gemini', inPerM: 1.25, outPerM: 10.00 },
  { id: 'gpt-4o-mini',      label: 'GPT-4o mini (저렴)',                     provider: 'OpenAI', inPerM: 0.15, outPerM: 0.60 },
  { id: 'gpt-4o',           label: 'GPT-4o (강력, 비쌈)',                    provider: 'OpenAI', inPerM: 2.50, outPerM: 10.00 },
  { id: 'gpt-4.1-mini',     label: 'GPT-4.1 mini (중간)',                    provider: 'OpenAI', inPerM: 0.40, outPerM: 1.60 },
  { id: 'gpt-4.1',          label: 'GPT-4.1 (강력)',                         provider: 'OpenAI', inPerM: 2.00, outPerM: 8.00 },
]

interface ByModelEntry { calls?: number; usd?: number }

interface Totals {
  memos?: number
  byCategory?: Record<string, number>
  bySource?: Record<string, number>
  byModel?: Record<string, ByModelEntry>
  geminiCalls?: number
  geminiPromptTokens?: number
  geminiOutputTokens?: number
  geminiUSD?: number
  lastMemoAt?: { toDate: () => Date }
}

interface AdminConfig {
  model?: string
}

interface DailyDoc {
  id: string // YYYY-MM-DD
  memos?: number
  geminiCalls?: number
  geminiUSD?: number
  byCategory?: Record<string, number>
  bySource?: Record<string, number>
}

const SOURCE_KO: Record<MemoSource | string, string> = {
  'foundation-models': 'Apple Intelligence',
  'template':          'iPhone 분석',
  'cloud-vision':      '클라우드 AI (Gemini)',
  'cloud-stub':        '클라우드 추정',
  'human':             '직접 작성',
}

function fmtUSD(n: number | undefined): string {
  const v = n ?? 0
  if (v < 0.01) return `$${v.toFixed(6)}`
  return `$${v.toFixed(4)}`
}

function fmtInt(n: number | undefined): string {
  return (n ?? 0).toLocaleString('en-US')
}

export function SuperAdmin({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [daily, setDaily] = useState<DailyDoc[]>([])
  const [recent, setRecent] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Live config — the function reads admin_config/global.model on every
  // photo (60s cache), so writing here switches the active model within a
  // minute, no deploy required.
  const [config, setConfig] = useState<AdminConfig | null>(null)
  const [saving, setSaving] = useState(false)
  // Regen modal: when set, we show a comparison overlay with the result of
  // running the photo through the currently active model.
  const [regenBusy, setRegenBusy] = useState<string | null>(null)
  const [regen, setRegen] = useState<RegenResult | null>(null)
  // One-shot migration state — see backfillPatientUid Cloud Function.
  const [backfillBusy, setBackfillBusy] = useState(false)
  const [backfill, setBackfill] = useState<BackfillResult | null>(null)
  const [memoMigrateBusy, setMemoMigrateBusy] = useState(false)
  const [memoMigrate, setMemoMigrate] = useState<BackfillMemoResult | null>(null)

  // Live subscription to the totals doc — it bumps on every new memo so the
  // dashboard updates without a refresh while a phone is uploading.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'admin_totals', 'global'),
      (snap) => {
        setTotals(snap.exists() ? (snap.data() as Totals) : {})
      },
      (err) => {
        console.error('[superadmin] totals subscribe', err)
        setError('통계를 불러올 수 없어요')
      },
    )
    return () => unsub()
  }, [])

  // One-shot read of the last 14 days of daily rollups for the trend table.
  // Cheap (≤14 docs) and we re-read on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'admin_daily'), orderBy('date', 'desc'), limit(14)),
        )
        if (cancelled) return
        setDaily(snap.docs.map((d) => ({ ...(d.data() as DailyDoc), id: d.id })))
      } catch (err) {
        console.error('[superadmin] daily read', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Live subscription to the active-model config doc. Cheap (1 small doc).
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'admin_config', 'global'),
      (snap) => setConfig(snap.exists() ? (snap.data() as AdminConfig) : {}),
      (err) => console.error('[superadmin] config subscribe', err),
    )
    return () => unsub()
  }, [])

  const onRegen = async (memoId: string) => {
    setRegenBusy(memoId)
    setError(null)
    try {
      // Function lives in us-west1 to match the storage trigger.
      const fn = httpsCallable<{ memoId: string }, RegenResult>(
        getFunctions(undefined, 'us-west1'),
        'regenerateMemo',
      )
      const res = await fn({ memoId })
      setRegen(res.data)
    } catch (err) {
      console.error('[superadmin] regen', err)
      setError(`재분석 실패: ${(err as Error).message}`)
    } finally {
      setRegenBusy(null)
    }
  }

  const onBackfill = async () => {
    if (!confirm('memos 컬렉션에 patientUid 필드를 채울까요? 이미 있는 문서는 건너뜁니다.')) return
    setBackfillBusy(true)
    setError(null)
    try {
      const fn = httpsCallable<Record<string, never>, BackfillResult>(
        getFunctions(undefined, 'us-west1'),
        'backfillPatientUid',
      )
      const res = await fn({})
      setBackfill(res.data)
    } catch (err) {
      console.error('[superadmin] backfill', err)
      setError(`마이그레이션 실패: ${(err as Error).message}`)
    } finally {
      setBackfillBusy(false)
    }
  }

  const onMemoMigrate = async () => {
    if (!confirm(
      '기존 memos를 새 스키마(activity=카테고리, memo=문장)로 변환할까요?\n'
      + '- 옛 activity(문장) → 새 memo\n'
      + '- 옛 category → 새 activity (일상 → 기타)\n'
      + '- details 필드 삭제\n'
      + '이미 변환된 문서는 건너뜁니다.',
    )) return
    setMemoMigrateBusy(true)
    setError(null)
    try {
      const fn = httpsCallable<Record<string, never>, BackfillMemoResult>(
        getFunctions(undefined, 'us-west1'),
        'backfillMemoSchema',
      )
      const res = await fn({})
      setMemoMigrate(res.data)
    } catch (err) {
      console.error('[superadmin] memo migrate', err)
      setError(`메모 스키마 마이그레이션 실패: ${(err as Error).message}`)
    } finally {
      setMemoMigrateBusy(false)
    }
  }

  const onChangeModel = async (newModel: string) => {
    if (newModel === (config?.model || 'gemini-2.5-flash')) return
    setSaving(true)
    try {
      // merge so we don't clobber other config keys we may add later.
      await setDoc(doc(db, 'admin_config', 'global'), { model: newModel }, { merge: true })
    } catch (err) {
      console.error('[superadmin] save config', err)
      setError('모델 변경에 실패했어요')
    } finally {
      setSaving(false)
    }
  }

  // Live subscription to the 20 most recent memos across all users. Admin
  // rules grant read access.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'memos'), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Memo, 'id'>) }))
        setRecent(arr)
      },
      (err) => {
        console.error('[superadmin] recent subscribe', err)
      },
    )
    return () => unsub()
  }, [])

  // Unique users seen — count distinct uids across the recent window. For a
  // precise count we'd want a server-side aggregation, but recent + totals
  // are enough for now.
  const [allTimeUsers, setAllTimeUsers] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Cap at 500 to keep cost bounded — past that we'd switch to a
        // function-maintained user counter.
        const snap = await getDocs(query(collection(db, 'memos'), limit(500)))
        if (cancelled) return
        const uids = new Set<string>()
        snap.forEach((d) => {
          const u = (d.data() as Memo).patientUid
          if (u) uids.add(u)
        })
        setAllTimeUsers(uids.size)
      } catch (err) {
        console.error('[superadmin] users count', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Today + 7d cost from the daily rollups.
  const todayKey = new Date().toISOString().slice(0, 10)
  const todayRow = daily.find((d) => d.id === todayKey)
  const last7Cost = daily.slice(0, 7).reduce((s, d) => s + (d.geminiUSD || 0), 0)

  return (
    <div className="admin">
      <header className="admin-bar">
        <div>
          <h1>관리자 대시보드</h1>
          <p className="muted">trackbyphoto.web.app / superadmin</p>
        </div>
        <button className="admin-signout" onClick={() => onSignOut()}>로그아웃</button>
      </header>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-section">
        <h2>마이그레이션</h2>
        <p className="muted picker-help">
          memos.uid → memos.patientUid 마이그레이션. 새 보안 규칙 배포 직후 한 번만 실행하세요. 멱등성 보장 — 여러 번 실행해도 안전합니다.
        </p>
        <button
          type="button"
          className="d-btn-primary"
          onClick={onBackfill}
          disabled={backfillBusy}
        >
          {backfillBusy ? '실행 중…' : 'patientUid 백필 실행'}
        </button>
        {backfill && (
          <pre style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-2)' }}>
            scanned: {backfill.scanned} · migrated: {backfill.migrated} · already ok: {backfill.alreadyOk} · skipped (no uid): {backfill.skippedNoUid}
          </pre>
        )}

        <p className="muted picker-help" style={{ marginTop: 24 }}>
          메모 스키마 변환: 옛 activity(문장)→memo, 옛 category→activity, details 삭제. 멱등성 보장.
        </p>
        <button
          type="button"
          className="d-btn-primary"
          onClick={onMemoMigrate}
          disabled={memoMigrateBusy}
        >
          {memoMigrateBusy ? '실행 중…' : '메모 스키마 백필 실행'}
        </button>
        {memoMigrate && (
          <pre style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-2)' }}>
            scanned: {memoMigrate.scanned} · migrated: {memoMigrate.migrated} · already ok: {memoMigrate.alreadyOk} · skipped (empty): {memoMigrate.skippedEmpty}
          </pre>
        )}
      </section>

      <section className="admin-section model-picker-section">
        <h2>활성 모델</h2>
        <p className="muted picker-help">
          새 사진을 분석할 모델을 고르세요. 변경 후 약 1분 안에 적용됩니다.
          비용은 사진 한 장당 예상치이며, 실제 비용은 사진 크기에 따라 달라집니다.
        </p>
        <div className="model-grid">
          {MODELS.map((m) => {
            const active = (config?.model || 'gemini-2.5-flash') === m.id
            // Typical photo memo: ~1k input + ~150 output tokens
            const perCallUSD = (1000 / 1_000_000) * m.inPerM + (150 / 1_000_000) * m.outPerM
            return (
              <button
                key={m.id}
                type="button"
                className={`model-card ${active ? 'active' : ''}`}
                onClick={() => onChangeModel(m.id)}
                disabled={saving}
              >
                <div className="model-top">
                  <span className={`model-prov ${m.provider.toLowerCase()}`}>{m.provider}</span>
                  {active && <span className="model-dot">● 활성</span>}
                </div>
                <div className="model-id">{m.id}</div>
                <div className="model-label">{m.label}</div>
                <div className="model-cost">
                  {fmtUSD(perCallUSD)} / 사진
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="admin-grid">
        <div className="stat-card">
          <div className="stat-label">총 메모</div>
          <div className="stat-value">{fmtInt(totals?.memos)}</div>
          {totals?.lastMemoAt && (
            <div className="stat-sub">
              마지막: {fmtDate(totals.lastMemoAt.toDate())} {fmtTime(totals.lastMemoAt.toDate())}
            </div>
          )}
        </div>

        <div className="stat-card">
          <div className="stat-label">고유 사용자 (최근 500건 기준)</div>
          <div className="stat-value">{allTimeUsers === null ? '…' : fmtInt(allTimeUsers)}</div>
        </div>

        <div className="stat-card highlight">
          <div className="stat-label">Gemini 누적 비용</div>
          <div className="stat-value">{fmtUSD(totals?.geminiUSD)}</div>
          <div className="stat-sub">
            호출 {fmtInt(totals?.geminiCalls)}회 · in {fmtInt(totals?.geminiPromptTokens)} / out {fmtInt(totals?.geminiOutputTokens)} 토큰
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">오늘 비용 (UTC)</div>
          <div className="stat-value">{fmtUSD(todayRow?.geminiUSD)}</div>
          <div className="stat-sub">{fmtInt(todayRow?.memos)}건 처리</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">최근 7일 비용</div>
          <div className="stat-value">{fmtUSD(last7Cost)}</div>
          <div className="stat-sub">일평균 {fmtUSD(last7Cost / 7)}</div>
        </div>
      </section>

      <section className="admin-section">
        <h2>모델별 사용량</h2>
        <p className="muted picker-help">
          누적 호출 수와 비용을 모델별로 집계해요. 모델을 바꾸면 새 호출만 새 모델에 누적돼요.
        </p>
        <div className="bar-list">
          {Object.entries(totals?.byModel || {})
            .sort((a, b) => (b[1].usd || 0) - (a[1].usd || 0))
            .map(([model, entry]) => {
              const totalUSD = Object.values(totals?.byModel || {})
                .reduce((s, e) => s + (e.usd || 0), 0)
              const pct = totalUSD > 0 ? Math.round(((entry.usd || 0) / totalUSD) * 100) : 0
              return (
                <div className="bar-row" key={model}>
                  <div className="bar-name">{model}</div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="bar-num">
                    {fmtInt(entry.calls)}회 · {fmtUSD(entry.usd)} · {pct}%
                  </div>
                </div>
              )
            })}
          {Object.keys(totals?.byModel || {}).length === 0 && (
            <div className="muted">아직 클라우드 모델 호출이 없어요.</div>
          )}
        </div>
      </section>

      <section className="admin-section">
        <h2>메모 출처 (AI 계층)</h2>
        <div className="bar-list">
          {Object.entries(totals?.bySource || {})
            .sort((a, b) => b[1] - a[1])
            .map(([src, n]) => {
              const total = totals?.memos || 1
              const pct = Math.round((n / total) * 100)
              return (
                <div className="bar-row" key={src}>
                  <div className="bar-name">{SOURCE_KO[src] || src}</div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="bar-num">{fmtInt(n)} · {pct}%</div>
                </div>
              )
            })}
          {Object.keys(totals?.bySource || {}).length === 0 && (
            <div className="muted">아직 데이터가 없어요.</div>
          )}
        </div>
      </section>

      <section className="admin-section">
        <h2>카테고리</h2>
        <div className="bar-list">
          {Object.entries(totals?.byCategory || {})
            .sort((a, b) => b[1] - a[1])
            .map(([cat, n]) => {
              const total = totals?.memos || 1
              const pct = Math.round((n / total) * 100)
              return (
                <div className="bar-row" key={cat}>
                  <div className="bar-name">{cat}</div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="bar-num">{fmtInt(n)} · {pct}%</div>
                </div>
              )
            })}
          {Object.keys(totals?.byCategory || {}).length === 0 && (
            <div className="muted">아직 데이터가 없어요.</div>
          )}
        </div>
      </section>

      <section className="admin-section">
        <h2>최근 14일 사용</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>날짜 (UTC)</th>
              <th>메모</th>
              <th>Gemini 호출</th>
              <th>비용</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td>{fmtInt(d.memos)}</td>
                <td>{fmtInt(d.geminiCalls)}</td>
                <td>{fmtUSD(d.geminiUSD)}</td>
              </tr>
            ))}
            {daily.length === 0 && !loading && (
              <tr><td colSpan={4} className="muted">아직 데이터가 없어요.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>최근 메모</h2>
        <div className="admin-recent">
          {recent.map((m) => (
            <div className="adm-row" key={m.id}>
              <div className="adm-thumb">
                {m.photoUrl
                  ? <img src={m.photoUrl} alt="" />
                  : <div className="adm-thumb-empty" />}
              </div>
              <div className="adm-info">
                <div className="adm-top">
                  <span className="adm-time">
                    {fmtDate(m.takenAt.toDate())} {fmtTime(m.takenAt.toDate())}
                  </span>
                  {m.activity && <span className="adm-cat">{m.activity}</span>}
                  {m.memoSource && (
                    <span className="adm-src">{SOURCE_KO[m.memoSource] || m.memoSource}</span>
                  )}
                  {m.model && <span className="adm-model">{m.model}</span>}
                </div>
                <div className="adm-act">{m.memo || '(작성 중)'}</div>
                <div className="adm-meta">
                  {/* Legacy memos written before the patientUid backfill carry
                      `uid` instead — fall back to that, then '—', so the
                      dashboard renders before migration runs. */}
                  <span>👤 {(m.patientUid || (m as unknown as { uid?: string }).uid || '—').slice(0, 8)}…</span>
                  <span>📍 {m.place || '위치 없음'}</span>
                </div>
                <button
                  type="button"
                  className="adm-regen"
                  onClick={() => onRegen(m.id)}
                  disabled={regenBusy === m.id || !m.photoPath}
                  title="현재 활성 모델로 다시 분석 (저장하지 않음)"
                >
                  {regenBusy === m.id ? '분석 중…' : '🔄 재분석'}
                </button>
              </div>
            </div>
          ))}
          {recent.length === 0 && <div className="muted">아직 메모가 없어요.</div>}
        </div>
      </section>

      {regen && (
        <div className="regen-modal" role="dialog" aria-modal="true" onClick={() => setRegen(null)}>
          <div className="regen-card" onClick={(e) => e.stopPropagation()}>
            <div className="regen-head">
              <h2>재분석 결과</h2>
              <button className="regen-close" onClick={() => setRegen(null)} aria-label="닫기">✕</button>
            </div>
            <div className="regen-cost">
              비용: {fmtUSD(regen.cost.totalUSD)} · in {fmtInt(regen.cost.promptTokens)} / out {fmtInt(regen.cost.outputTokens)} 토큰
            </div>
            <div className="regen-cols">
              <div className="regen-col">
                <div className="regen-col-head">
                  <span className="regen-label">이전</span>
                  {regen.old.model
                    ? <span className="regen-model">{regen.old.model}</span>
                    : <span className="regen-model muted">{regen.old.memoSource || '—'}</span>}
                </div>
                <div className="regen-cat">{regen.old.activity || '—'}</div>
                <div className="regen-act">{regen.old.memo || '(없음)'}</div>
                <div className="regen-det">{regen.old.scene || '(장면 없음)'}</div>
              </div>
              <div className="regen-col new">
                <div className="regen-col-head">
                  <span className="regen-label">새로운 결과</span>
                  <span className="regen-model">{regen.new.model}</span>
                </div>
                <div className="regen-cat">{regen.new.activity}</div>
                <div className="regen-act">{regen.new.memo}</div>
                <div className="regen-det">{regen.new.scene || '(장면 없음)'}</div>
              </div>
            </div>
            <div className="regen-note muted">
              ※ 새 결과는 표시만 되며 저장되지 않아요.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
