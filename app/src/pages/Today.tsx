import { fmtDate, fmtTime, isSameDay } from '../util'
import { deleteMemo } from '../lib/capture'
import { useToast } from '../components/Toast'
import { categoryThumbClass } from '../lib/categoryStyle'
import type { Memo } from '../types'

export function Today({ memos, onOpen, onOpenAsk }: { memos: Memo[]; onOpen: (id: string) => void; onOpenAsk: () => void }) {
  const toast = useToast()
  const today = new Date()
  const items = memos.filter((m) => isSameDay(m.takenAt.toDate(), today))

  return (
    <section className="page">
      <div className="h-eyebrow">{fmtDate(today)}</div>
      <h2 className="h-title">오늘</h2>

      <div className="tl-ask-row">
        <button className="askbtn" onClick={onOpenAsk} aria-label="지난 기록 물어보기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20.5 20.5l-3.6-3.6" />
          </svg>
          지난 기록 물어보기
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="big">🌤️</div>
          <div>아직 오늘 기록이 없어요.</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>홈에서 사진을 한 장 찍어보세요.</div>
        </div>
      ) : (
        <div>
          {items.map((m) => {
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
                    {m.status === 'pending' ? '메모 작성 중…' : m.memo}
                  </div>
                </div>
                <span
                  className="del-btn"
                  role="button"
                  aria-label="사진 삭제"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!confirm('이 사진을 삭제할까요?')) return
                    deleteMemo({ memoId: m.id, photoPath: m.photoPath }).catch((err) => {
                      console.error(err)
                      toast.show('삭제에 실패했어요', '잠시 후 다시 시도해주세요')
                    })
                  }}
                >
                  ✕
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
