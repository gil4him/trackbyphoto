import { useMemo, useState } from 'react'
import type { Memo } from '../types'
import { fmtDate, fmtTime, isSameDay } from '../util'

interface Props {
  memos: Memo[]
  onClose: () => void
  onOpen: (id: string) => void
}

/**
 * Search modal opened from the Home page.
 *
 * Inputs: a date (When) and a free-text activity query (What). Both are
 * optional; behavior depends on which are filled:
 *
 *   date + text  →  matching memos on that day
 *   date only    →  all memos on that day
 *   text only    →  matching memos across every day, grouped by date
 *   neither      →  show the help card explaining the three modes
 *
 * No backend round-trip — we filter the in-memory memos snapshot from
 * useMemos. Cheap (≤ a few hundred docs) and works offline.
 */
export function Ask({ memos, onClose, onOpen }: Props) {
  // HTML <input type="date"> stores YYYY-MM-DD. Empty string = no date filter.
  const [dateStr, setDateStr] = useState('')
  const [text, setText] = useState('')

  const ready = useMemo(() => memos.filter((m) => m.status === 'ready'), [memos])

  const results = useMemo(() => {
    const q = text.trim().toLowerCase()
    const hasDate = !!dateStr
    const hasText = !!q
    if (!hasDate && !hasText) return [] as Memo[]

    let filtered = ready
    if (hasDate) {
      // Parse as local-date midnight so comparison matches the user's wall
      // clock. (new Date('YYYY-MM-DD') would treat it as UTC and shift a
      // day in the user's tz.)
      const [y, mo, d] = dateStr.split('-').map(Number)
      const target = new Date(y, mo - 1, d)
      filtered = filtered.filter((m) => isSameDay(m.takenAt.toDate(), target))
    }
    if (hasText) {
      filtered = filtered.filter((m) => {
        const hay = [m.activity, m.details, m.place, m.category]
          .filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    return filtered
  }, [ready, dateStr, text])

  // Group results by local-date key for the "text only" view, which can span
  // multiple days. Same grouping works for the other modes (single day → one
  // group), so we use it unconditionally.
  const grouped = useMemo(() => {
    const byDay = new Map<string, Memo[]>()
    for (const m of results) {
      const d = m.takenAt.toDate()
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key)!.push(m)
    }
    return Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [results])

  const hasQuery = !!dateStr || !!text.trim()
  const clear = () => { setDateStr(''); setText('') }

  return (
    <div className="ask-modal" role="dialog" aria-modal="true">
      <div className="ask-bar">
        <button className="ask-close" onClick={onClose} aria-label="닫기">← 닫기</button>
        <h2>찾아보기</h2>
        {hasQuery && <button className="ask-clear" onClick={clear}>초기화</button>}
      </div>

      <div className="ask-form">
        <label className="ask-field">
          <span>언제 (When)</span>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
          />
        </label>
        <label className="ask-field">
          <span>무엇을 (What)</span>
          <input
            type="text"
            placeholder="예: 식사, 산책, 카페, 공원"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            inputMode="search"
          />
        </label>
      </div>

      <div className="ask-results">
        {!hasQuery && (
          <div className="ask-empty">
            <p className="ask-empty-lead">날짜를 고르거나 활동을 입력해 주세요.</p>
            <ul className="ask-modes">
              <li><b>날짜 + 활동</b> — 그 날의 관련 메모</li>
              <li><b>날짜만</b> — 그 날의 모든 메모</li>
              <li><b>활동만</b> — 매일의 관련 메모</li>
            </ul>
          </div>
        )}

        {hasQuery && results.length === 0 && (
          <div className="ask-empty">
            <p>일치하는 메모가 없어요.</p>
          </div>
        )}

        {hasQuery && results.length > 0 && (
          <>
            <div className="ask-summary">{results.length}건 찾았어요</div>
            {grouped.map(([day, list]) => {
              const [y, mo, d] = day.split('-').map(Number)
              const dayDate = new Date(y, mo - 1, d)
              return (
                <div className="ask-group" key={day}>
                  <div className="ask-day">
                    {fmtDate(dayDate)}
                    <small>{list.length}건</small>
                  </div>
                  <div className="ask-list">
                    {list.map((m) => (
                      <button
                        type="button"
                        className="ask-item"
                        key={m.id}
                        onClick={() => { onOpen(m.id); onClose() }}
                      >
                        {m.photoUrl
                          ? <img src={m.photoUrl} alt="" />
                          : <div className="ask-noimg" />}
                        <div className="ask-info">
                          <div className="ask-time">
                            {fmtTime(m.takenAt.toDate())}
                            {m.category && <span className="cat">{m.category}</span>}
                          </div>
                          <div className="ask-act">{m.activity}</div>
                          {m.details && <div className="ask-det">{m.details}</div>}
                          <div className="ask-place">📍 {m.place || '위치 정보 없음'}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
