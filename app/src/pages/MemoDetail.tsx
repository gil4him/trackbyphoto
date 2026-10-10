import { useEffect, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from '../components/Toast'
import { deleteMemo } from '../lib/capture'
import { fmtDate, fmtTime } from '../util'
import { categoryThumbClass } from '../lib/categoryStyle'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import { Reactions, type ReactionsContext } from '../components/Reactions'
import { markRead } from '../lib/reactions'
import type { Memo, MemoSource } from '../types'
import { mapLink } from '../lib/memoViews'
import { isSimple } from '../lib/edition'

// 'stored-only' has no badge on purpose: nothing says a step was skipped.
const SOURCE_BADGES: Partial<Record<MemoSource, { label: string; tone: 'good' | 'neutral' | 'warn' }>> = {
  'foundation-models': { label: 'Apple Intelligence', tone: 'good' },
  'template':          { label: 'iPhone 분석',         tone: 'neutral' },
  'local-llm':         { label: 'AI 분석',             tone: 'good' },
  // Same words for the family: which model wrote it is not their concern.
  'cloud-llm':         { label: 'AI 분석',             tone: 'good' },
  'local-stub':        { label: 'AI 추정',             tone: 'warn' },
  'cloud-vision':      { label: '클라우드 AI',         tone: 'good' },
  'cloud-stub':        { label: '클라우드 추정',        tone: 'warn' },
  'human':             { label: '직접 작성',           tone: 'good' },
}

const TITLE_MAX = 40
const BODY_MAX = 200

/**
 * One photo's record: the subject line, then a box with a few short
 * sentences, then the place. Family can correct the text by hand or ask the
 * worker to write it again from the photo.
 * `readOnly` (an elder's linked phone): no delete, no edit.
 */
export function MemoDetail({ memo, onBack, readOnly = false, rx }: { memo: Memo; onBack: () => void; readOnly?: boolean; rx?: ReactionsContext }) {
  const toast = useToast()
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Family opening the page has seen the parent's replies on this photo.
  const unseenReplies = rx?.canReact
    ? (rx.byMemo.get(memo.id) ?? []).filter((r) => r.actorUid === rx.patientUid && !r.readByFamilyAt && r.status === 'ready').map((r) => r.id).join(',')
    : ''
  useEffect(() => {
    if (unseenReplies) markRead(unseenReplies.split(','), 'family')
  }, [unseenReplies])

  const takenAt = memo.takenAt.toDate()
  const badge = memo.memoSource ? SOURCE_BADGES[memo.memoSource] : null
  const grad = categoryThumbClass(memo.activity)
  // Pending with text already there means the worker is re-writing it.
  const rewriting = memo.status === 'pending' && !!memo.memo
  // The memo server is off or its model isn't answering: say so, don't spin.
  const serverDown = useWorkerStatus(memo.status === 'pending') === 'down'
  const waitingText = serverDown ? '메모 서버가 잠시 쉬고 있어요. 다시 켜지면 자동으로 써 드려요.' : '메모 작성 중…'
  const body = memo.scene || ''

  const startEdit = () => {
    setDraftTitle(memo.memo)
    setDraftBody(body)
    setEditing(true)
  }

  const saveEdit = async () => {
    const title = draftTitle.trim()
    const text = draftBody.trim()
    if (!title) {
      toast.show('제목을 입력해주세요', '비워둘 수 없어요')
      return
    }
    if (title === memo.memo && text === body) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'memos', memo.id), {
        memo: title,
        scene: text,
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

  // Put the memo back in the worker's queue. Clearing humanEdited lets the
  // worker replace hand-written text too — that's what was asked for.
  const rewrite = async () => {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'memos', memo.id), { status: 'pending', humanEdited: false })
      toast.show('메모를 다시 쓰고 있어요', '잠시만 기다려 주세요')
    } catch (err) {
      console.error('[memo rewrite] failed', err)
      toast.show('다시 쓰지 못했어요', '잠시 후 다시 시도해주세요')
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

  const mapUrl = mapLink(memo, isSimple())

  return (
    <section className="page detail">
      <div className="detail-topbar">
        <button className="back" onClick={onBack} aria-label="뒤로가기">‹ 뒤로</button>
        {!readOnly && <button className="del-text" onClick={onDelete}>삭제</button>}
      </div>

      {/* Photo header — falls back to a category-tinted gradient if no
          image yet (still uploading) so the review screen never goes blank. */}
      <div className={`detail-photo ${memo.photoUrl ? 'has-img' : grad}`}>
        {memo.photoUrl
          ? <img src={memo.photoUrl} alt="" />
          : <div className="detail-photo-empty">사진을 불러오는 중…</div>}
      </div>

      <div className="detail-memo">
        {memo.memo || (serverDown ? '메모를 기다리는 중이에요' : '메모 작성 중…')}
      </div>

      <div className="detail-meta">
        <span className="pill t">{fmtDate(takenAt)} · {fmtTime(takenAt)}</span>
        {memo.activity && <span className="pill">{memo.activity}</span>}
        {memo.place && <span className="pill p">{memo.place}</span>}
      </div>

      <div className="detail-section">
        <div className="d-label">
          <span>메모</span>
          {rewriting
            ? <span className="src-badge tone-neutral">{serverDown ? '서버가 쉬는 중' : '다시 쓰는 중…'}</span>
            : memo.humanEdited
              ? <span className="src-badge tone-good">직접 작성</span>
              : badge && <span className={`src-badge tone-${badge.tone}`}>{badge.label}</span>}
        </div>
        {editing ? (
          <div className="d-edit">
            <label htmlFor="memo-title">제목</label>
            <input
              id="memo-title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              maxLength={TITLE_MAX}
              autoFocus
            />
            <label htmlFor="memo-body">설명</label>
            <textarea
              id="memo-body"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={3}
              maxLength={BODY_MAX}
            />
            <div className="d-edit-actions">
              <button className="d-btn-secondary" disabled={saving} onClick={() => setEditing(false)}>취소</button>
              <button className="d-btn-primary" disabled={saving} onClick={saveEdit}>{saving ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        ) : (
          <>
            {body
              ? <p className="d-scene">{body}</p>
              : <p className="d-scene muted">{memo.memo ? '설명이 아직 없어요.' : waitingText}</p>}
            {!readOnly && memo.memo && !rewriting && (
              <div className="d-actions">
                <button className="d-btn-secondary" disabled={saving} onClick={rewrite}>AI로 다시 쓰기</button>
                <button className="d-btn-secondary" disabled={saving} onClick={startEdit}>직접 수정</button>
              </div>
            )}
          </>
        )}
      </div>

      {rx && (
        <div className="detail-section">
          <div className="d-label"><span>가족 이야기</span></div>
          <Reactions memoId={memo.id} ctx={rx} />
        </div>
      )}

      <div className="detail-section">
        <div className="d-label"><span>장소</span></div>
        <div className="d-place">
          <div className="d-place-main">
            <span>📍 {memo.place || '위치 정보 없음'}</span>
            {memo.address && <span className="d-address">{memo.address}</span>}
          </div>
          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="d-map-link">
              지도에서 보기 →
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
