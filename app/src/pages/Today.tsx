import { fmtDate, fmtTime, isSameDay } from '../util'
import type { Memo } from '../types'

export function Today({ memos }: { memos: Memo[] }) {
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
            <div className="memo" key={m.id}>
              <div className="ph">
                {m.photoUrl
                  ? <img src={m.photoUrl} alt="" />
                  : <div style={{ width: '100%', height: '100%', background: '#eee' }} />}
              </div>
              <div className="body">
                <div className="time">
                  {fmtTime(m.takenAt.toDate())}
                  {m.category && <span className="cat">{m.category}</span>}
                </div>
                <div className="activity">
                  {m.status === 'pending' ? '메모 작성 중…' : m.activity}
                </div>
                <div className="place">📍 {m.place || '위치 정보 없음'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
