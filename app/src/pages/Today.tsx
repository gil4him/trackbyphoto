import { fmtDate, fmtTime, isSameDay } from '../util'
import { deleteMemo } from '../lib/capture'
import { useToast } from '../components/Toast'
import type { Memo } from '../types'

export function Today({ memos, onOpen }: { memos: Memo[]; onOpen: (id: string) => void }) {
  const toast = useToast()
  const today = new Date()
  const items = memos.filter((m) => isSameDay(m.takenAt.toDate(), today))

  return (
    <section className="page active">
      <div className="day-head">
        <h2>{fmtDate(today)}</h2>
        <div className="count">{items.length}건</div>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="big">🌤️</div>
          <div>아직 오늘 기록이 없어요.</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>홈에서 사진을 한 장 찍어보세요.</div>
        </div>
      ) : (
        <div className="timeline">
          {items.map((m) => (
            <button
              type="button"
              className="memo memo-btn"
              key={m.id}
              onClick={() => onOpen(m.id)}
              aria-label="자세히 보기"
            >
              <div className="ph">
                {m.photoUrl
                  ? <img src={m.photoUrl} alt="" />
                  : <div style={{ width: '100%', height: '100%', background: '#eee' }} />}
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
              </div>
              <div className="body">
                <div className="time">
                  {fmtTime(m.takenAt.toDate())}
                  {m.category && <span className="cat">{m.category}</span>}
                </div>
                <div className="activity">
                  {m.status === 'pending' ? '메모 작성 중…' : m.activity}
                </div>
                {m.status === 'ready' && m.details && (
                  <div className="details">{m.details}</div>
                )}
                <div className="place">📍 {m.place || '위치 정보 없음'}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
