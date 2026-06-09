import { useEffect, useState } from 'react'
import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query,
} from 'firebase/firestore'
import { db } from '../firebase'
import { fmtDate, fmtTime } from '../util'
import type { Memo, MemoSource } from '../types'

/** Single source of truth for the admin email. Mirrored in firestore.rules. */
export const ADMIN_EMAIL = 'zymer4him@gmail.com'

interface Totals {
  memos?: number
  byCategory?: Record<string, number>
  bySource?: Record<string, number>
  geminiCalls?: number
  geminiPromptTokens?: number
  geminiOutputTokens?: number
  geminiUSD?: number
  lastMemoAt?: { toDate: () => Date }
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
          const u = (d.data() as Memo).uid
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
            <div className="recent-row" key={m.id}>
              <div className="recent-thumb">
                {m.photoUrl
                  ? <img src={m.photoUrl} alt="" />
                  : <div className="recent-thumb-empty" />}
              </div>
              <div className="recent-info">
                <div className="recent-top">
                  <span className="recent-time">
                    {fmtDate(m.takenAt.toDate())} {fmtTime(m.takenAt.toDate())}
                  </span>
                  {m.category && <span className="recent-cat">{m.category}</span>}
                  {m.memoSource && (
                    <span className="recent-src">{SOURCE_KO[m.memoSource] || m.memoSource}</span>
                  )}
                </div>
                <div className="recent-act">{m.activity || '(작성 중)'}</div>
                <div className="recent-meta">
                  <span>👤 {m.uid.slice(0, 8)}…</span>
                  <span>📍 {m.place || '위치 없음'}</span>
                </div>
              </div>
            </div>
          ))}
          {recent.length === 0 && <div className="muted">아직 메모가 없어요.</div>}
        </div>
      </section>
    </div>
  )
}
