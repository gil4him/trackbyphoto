import { useMemo, useState } from 'react'
import type { Memo, MemoCategory } from '../types'
import { fmtTime, isSameDay } from '../util'
import { categoryThumbClass } from '../lib/categoryStyle'

type WhenKey = 'today' | 'yesterday' | 'week' | 'all'
type WhatKey = 'all' | MemoCategory

const WHEN_OPTIONS: { key: WhenKey; label: string }[] = [
  { key: 'today',     label: '오늘' },
  { key: 'yesterday', label: '어제' },
  { key: 'week',      label: '이번 주' },
  { key: 'all',       label: '전체 기간' },
]

// Mirror the schema in types.ts. We keep "기타" in the picker since real memos
// fall through there when the AI can't classify.
const WHAT_OPTIONS: { key: WhatKey; label: string }[] = [
  { key: 'all',  label: '전체' },
  { key: '식사', label: '식사' },
  { key: '산책', label: '산책' },
  { key: '휴식', label: '휴식' },
  { key: '가족', label: '가족' },
  { key: '꽃',   label: '꽃'   },
  { key: '기타', label: '기타' },
]

/**
 * Ask page — chip-based filter UI. Two axes:
 *   언제: 오늘 · 어제 · 이번 주 · 전체 기간
 *   무엇을: 전체 · 식사 · 산책 · 휴식 · 가족 · 꽃 · 기타
 * In 이번 주 / 전체 기간 modes results group by day. Filtering is in-memory
 * over the live memos snapshot — no backend round-trip.
 */
export function Ask({ memos, onOpen }: { memos: Memo[]; onOpen: (id: string) => void }) {
  const [askWhen, setAskWhen] = useState<WhenKey>('today')
  const [askWhat, setAskWhat] = useState<WhatKey>('all')

  const ready = useMemo(() => memos.filter((m) => m.status === 'ready'), [memos])

  const results = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    // Monday-anchored current week (matches prototype: dow = (day+6)%7).
    const t0 = new Date(today); t0.setHours(0, 0, 0, 0)
    const dow = (t0.getDay() + 6) % 7
    const monday = new Date(t0); monday.setDate(t0.getDate() - dow)
    const inWhen = (taken: Date): boolean => {
      if (askWhen === 'all') return true
      if (askWhen === 'today') return isSameDay(taken, today)
      if (askWhen === 'yesterday') return isSameDay(taken, yesterday)
      if (askWhen === 'week') return taken >= monday && taken <= today
      return false
    }
    return ready.filter((m) => {
      if (!inWhen(m.takenAt.toDate())) return false
      if (askWhat !== 'all' && m.activity !== askWhat) return false
      return true
    })
  }, [ready, askWhen, askWhat])

  const grouped = askWhen === 'week' || askWhen === 'all'

  const groupedByDate = useMemo(() => {
    if (!grouped) return null
    const map = new Map<string, Memo[]>()
    for (const m of results) {
      const d = m.takenAt.toDate()
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [results, grouped])

  const card = (m: Memo) => {
    const grad = categoryThumbClass(m.activity)
    return (
      <button
        type="button"
        className="tl-item"
        key={m.id}
        onClick={() => onOpen(m.id)}
        aria-label="자세히 보기"
      >
        <div className={`tl-thumb ${m.photoUrl ? '' : grad}`}>
          {m.photoUrl && <img src={m.photoUrl} alt="" />}
        </div>
        <div className="tl-body">
          <div className="when">{fmtTime(m.takenAt.toDate())}</div>
          <div className="act">{m.activity || '기록'}</div>
          <div className="desc">
            {m.place ? `${m.place} · ` : ''}
            {m.memo}
          </div>
        </div>
      </button>
    )
  }

  const dayLabel = (key: string): string => {
    const [y, mo, d] = key.split('-').map(Number)
    const dt = new Date(y, mo - 1, d)
    const days = ['일', '월', '화', '수', '목', '금', '토']
    return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${days[dt.getDay()]}요일`
  }

  return (
    <section className="page">
      <div className="h-eyebrow">물어보기</div>
      <h2 className="h-title" style={{ marginBottom: 4 }}>언제 · 무엇을 찾아볼까요</h2>

      <div className="q-lab">언제</div>
      <div className="qrow">
        {WHEN_OPTIONS.map((o) => (
          <button
            key={o.key}
            className={`qchip ${askWhen === o.key ? 'on' : ''}`}
            onClick={() => setAskWhen(o.key)}
          >{o.label}</button>
        ))}
      </div>

      <div className="q-lab">무엇을</div>
      <div className="qrow">
        {WHAT_OPTIONS.map((o) => (
          <button
            key={o.key}
            className={`qchip ${askWhat === o.key ? 'on' : ''}`}
            onClick={() => setAskWhat(o.key)}
          >{o.label}</button>
        ))}
      </div>

      <div className="q-results">
        {results.length === 0 ? (
          <div className="q-empty">
            해당하는 기록이 없어요.<br />
            다른 날짜나 활동을 눌러보세요.
          </div>
        ) : (
          <>
            <div className="q-count">{results.length}건을 찾았어요</div>
            {grouped && groupedByDate
              ? groupedByDate.map(([key, list]) => (
                  <div key={key}>
                    <div className="q-datehdr">{dayLabel(key)}</div>
                    {list.map(card)}
                  </div>
                ))
              : results.map(card)}
          </>
        )}
      </div>
    </section>
  )
}
