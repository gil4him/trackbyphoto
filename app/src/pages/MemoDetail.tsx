import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from '../components/Toast'
import { deleteMemo } from '../lib/capture'
import { fmtDate, fmtTime } from '../util'
import type { Memo, MemoSource } from '../types'

// Translate the most common Vision labels into short Korean strings so the
// "AI가 본 것" chip strip is intelligible to Korean family members. Anything
// not in the map renders as the raw English label — better than hiding it.
const LABEL_KO: Record<string, string> = {
  food: '음식', meal: '식사', plate: '접시', bowl: '그릇', dish: '음식',
  drink: '음료', beverage: '음료', cup: '컵', fruit: '과일', vegetable: '채소',
  park: '공원', tree: '나무', outdoor: '야외', street: '거리', walk: '길',
  sky: '하늘', grass: '잔디', path: '길', garden: '정원', trail: '오솔길',
  sofa: '소파', chair: '의자', bed: '침대', tv: 'TV', television: 'TV',
  book: '책', tea: '차', indoor: '실내', 'home interior': '실내',
  person: '사람', animal: '동물',
}
function koLabel(name: string): string {
  return LABEL_KO[name.toLowerCase()] || name
}

const SOURCE_BADGES: Record<MemoSource, { label: string; tone: 'good' | 'neutral' | 'warn' }> = {
  'foundation-models': { label: 'Apple Intelligence', tone: 'good' },
  'template':          { label: 'iPhone 분석',         tone: 'neutral' },
  'cloud-stub':        { label: '클라우드 추정',        tone: 'warn' },
  'human':             { label: '직접 작성',           tone: 'good' },
}

export function MemoDetail({ memo, onBack }: { memo: Memo; onBack: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState(memo.activity)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showTags, setShowTags] = useState(false)

  const takenAt = memo.takenAt.toDate()
  const badge = memo.memoSource ? SOURCE_BADGES[memo.memoSource] : null

  const saveEdit = async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      toast.show('메모 내용을 입력해주세요', '비워둘 수 없어요')
      return
    }
    if (trimmed === memo.activity) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'memos', memo.id), {
        activity: trimmed,
        memoSource: 'human',
        humanEdited: true,
      })
      setEditing(false)
      toast.show('메모를 저장했어요', '')
    } catch (err) {
      console.error('[memo edit] failed', err)
      toast.show('저장에 실패했어요', '잠시 후 다시 시도해주세요')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = () => {
    if (!confirm('이 사진을 삭제할까요?')) return
    deleteMemo({ memoId: memo.id, photoPath: memo.photoPath })
      .then(onBack)
      .catch((err) => {
        console.error(err)
        toast.show('삭제에 실패했어요', '잠시 후 다시 시도해주세요')
      })
  }

  // Apple/Google/Kakao all accept maps URL with lat,lng — Apple Maps opens
  // natively on iOS, Google Maps elsewhere. Cheap, no API key required.
  const mapUrl = memo.lat != null && memo.lng != null
    ? `https://maps.apple.com/?ll=${memo.lat},${memo.lng}&q=${encodeURIComponent(memo.place || '위치')}`
    : null

  return (
    <section className="page active detail">
      <div className="detail-topbar">
        <button className="back" onClick={onBack} aria-label="뒤로가기">← 뒤로</button>
        <button className="del-text" onClick={onDelete}>삭제</button>
      </div>

      <div className="detail-photo">
        {memo.photoUrl
          ? <img src={memo.photoUrl} alt="" />
          : <div className="detail-photo-empty">사진을 불러오는 중…</div>}
      </div>

      <div className="detail-when">
        <div className="d-date">{fmtDate(takenAt)}</div>
        <div className="d-time">{fmtTime(takenAt)}</div>
        {memo.category && <span className="cat">{memo.category}</span>}
      </div>

      <div className="detail-section">
        <div className="d-label">
          <span>활동</span>
          {badge && !memo.humanEdited && (
            <span className={`src-badge tone-${badge.tone}`}>{badge.label}</span>
          )}
          {memo.humanEdited && <span className="src-badge tone-good">직접 작성</span>}
        </div>
        {editing ? (
          <div className="d-edit">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={80}
              autoFocus
            />
            <div className="d-edit-actions">
              <button
                className="d-btn-secondary"
                disabled={saving}
                onClick={() => { setDraft(memo.activity); setEditing(false) }}
              >취소</button>
              <button
                className="d-btn-primary"
                disabled={saving}
                onClick={saveEdit}
              >{saving ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        ) : (
          <button className="d-activity" onClick={() => setEditing(true)} aria-label="활동 메모 편집">
            {memo.activity || '메모 작성 중…'}
            <span className="edit-hint">탭하여 수정</span>
          </button>
        )}
      </div>

      <div className="detail-section">
        <div className="d-label"><span>장소</span></div>
        <div className="d-place">
          📍 {memo.place || '위치 정보 없음'}
          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="d-map-link">
              지도에서 보기 →
            </a>
          )}
        </div>
      </div>

      {memo.tags && (memo.tags.labels.length > 0 || memo.tags.text.length > 0 || memo.tags.faceCount > 0) && (
        <div className="detail-section">
          <button
            className="d-collapse"
            onClick={() => setShowTags((v) => !v)}
            aria-expanded={showTags}
          >
            <span>AI가 본 것</span>
            <span className="caret">{showTags ? '▾' : '▸'}</span>
          </button>
          {showTags && (
            <div className="d-tags">
              {memo.tags.labels.length > 0 && (
                <div className="d-chiprow">
                  {memo.tags.labels.slice(0, 6).map((l) => (
                    <span className="chip" key={l.name}>
                      {koLabel(l.name)}
                      <small>{Math.round(l.confidence * 100)}%</small>
                    </span>
                  ))}
                </div>
              )}
              {memo.tags.text.length > 0 && (
                <div className="d-chiprow">
                  {memo.tags.text.slice(0, 4).map((t, i) => (
                    <span className="chip chip-text" key={i}>“{t}”</span>
                  ))}
                </div>
              )}
              {memo.tags.faceCount > 0 && (
                <div className="d-chiprow">
                  <span className="chip">사람 {memo.tags.faceCount}명</span>
                </div>
              )}
              <p className="d-tags-note">
                위 정보는 사진에서 자동으로 감지된 내용이에요. 활동 메모가 맞지 않다면 위에서 직접 수정해 주세요.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
