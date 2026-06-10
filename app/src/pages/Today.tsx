import { useMemo } from 'react'
import { fmtTime, relativeDateLabel } from '../util'
import { deleteMemo } from '../lib/capture'
import { useToast } from '../components/Toast'
import { MemoThumb } from '../components/MemoThumb'
import type { Memo } from '../types'

export function Today({ memos, onOpen }: { memos: Memo[]; onOpen: (id: string) => void }) {
  const toast = useToast()

  // Group recent shots by calendar day, newest day first. `memos` already
  // arrives ordered by takenAt desc (useMemos), so iterating in order keeps
  // both the groups and the cards within each group newest-first.
  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; items: Memo[] }>()
    for (const m of memos) {
      const d = m.takenAt.toDate()
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map.has(key)) map.set(key, { date: d, items: [] })
      map.get(key)!.items.push(m)
    }
    return Array.from(map.values())
  }, [memos])

  const onDelete = (m: Memo) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('이 사진을 삭제할까요?')) return
    deleteMemo({ memoId: m.id, photoPath: m.photoPath }).catch((err) => {
      console.error(err)
      toast.show('삭제에 실패했어요', '잠시 후 다시 시도해주세요')
    })
  }

  return (
    <section className="page">
      <div className="h-eyebrow">최근 기록</div>
      <h2 className="h-title">사진</h2>

      {groups.length === 0 ? (
        <div className="empty">
          <div className="big">🌤️</div>
          <div>아직 기록이 없어요.</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>홈에서 사진을 한 장 찍어보세요.</div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.date.toISOString()}>
            <div className="q-datehdr">{relativeDateLabel(g.date)}</div>
            {g.items.map((m) => (
              <button
                type="button"
                className="tl-item"
                key={m.id}
                onClick={() => onOpen(m.id)}
                aria-label="자세히 보기"
              >
                <MemoThumb memo={m} />
                <div className="tl-body">
                  <div className="when">{fmtTime(m.takenAt.toDate())}</div>
                  <div className="act">{m.activity || '기록'}</div>
                  <div className="desc">
                    {m.place ? `${m.place} · ` : ''}
                    {m.status === 'pending' ? '메모 작성 중…' : m.memo}
                  </div>
                </div>
                <span
                  className="del-btn"
                  role="button"
                  aria-label="사진 삭제"
                  onClick={onDelete(m)}
                >
                  ✕
                </span>
              </button>
            ))}
          </div>
        ))
      )}
    </section>
  )
}
