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
import { detailActions, mapLink, type DetailAction } from '../lib/memoViews'
import { BottomSheet } from '../components/BottomSheet'
import { isSimple } from '../lib/edition'
import { Capacitor } from '@capacitor/core'
import { downloadPhoto, sharePhoto } from '../lib/photoShare'

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
 * The header holds back, the date and ⋯, which opens the rest (공유하기,
 * 저장, 수정, 다시 쓰기, 삭제) in a sheet; 공유하기 also stays under the photo.
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

  // The ⋯ sheet: its menu, or 삭제's confirmation in its place.
  const [sheet, setSheet] = useState<null | 'menu' | 'confirm'>(null)
  const closeSheet = () => setSheet(null)

  const onDelete = () => {
    setSheet(null)
    deleteMemo({ memoId: memo.id, photoPath: memo.photoPath })
      .then(onBack)
      .catch((err) => {
        console.error(err)
        toast.show('삭제에 실패했어요', '잠시 후 다시 시도해주세요')
      })
  }

  const mapUrl = mapLink(memo, isSimple())

  const [sharing, setSharing] = useState(false)
  const passOn = async (run: () => Promise<unknown>) => {
    setSharing(true)
    try {
      await run()
    } catch (err) {
      console.error('[share] photo failed', err)
      toast.show('사진을 보내지 못했어요', '잠시 후 다시 시도해 주세요')
    } finally {
      setSharing(false)
    }
  }
  const onShare = () => passOn(() => sharePhoto(memo))
  const onDownload = () => passOn(() => downloadPhoto(memo))

  const actions = detailActions({
    simple: isSimple(), readOnly, native: Capacitor.isNativePlatform(),
    hasPhoto: !!memo.photoUrl, hasMemo: !!memo.memo, rewriting,
  })
  const ACTION_LABELS: Record<DetailAction, string> = { share: '공유하기', save: '사진 저장', edit: '직접 수정', rewrite: 'AI로 다시 쓰기', delete: '삭제' }
  const runAction = (a: DetailAction) => {
    if (a === 'delete') return setSheet('confirm')
    setSheet(null)
    if (a === 'share') void onShare()
    else if (a === 'save') void onDownload()
    else if (a === 'edit') startEdit()
    else void rewrite()
  }
  const canShare = actions.includes('share')

  return (
    <section className="page detail">
      <div className="detail-head">
        <button type="button" className="head-btn" onClick={onBack} aria-label="뒤로가기">‹</button>
        <div className="detail-head-when">{fmtDate(takenAt)} · {fmtTime(takenAt)}</div>
        {actions.length > 0
          ? <button type="button" className="head-btn" onClick={() => setSheet('menu')} aria-label="더보기" aria-haspopup="dialog">⋯</button>
          : <span className="head-btn-space" aria-hidden="true" />}
      </div>

      {sheet === 'menu' && (
        <BottomSheet onClose={closeSheet}>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={`sheet-item${a === 'delete' ? ' danger sep' : ''}`}
              disabled={(a === 'share' || a === 'save') ? sharing : (a !== 'delete' && saving)}
              onClick={() => runAction(a)}
            >{ACTION_LABELS[a]}</button>
          ))}
          <button type="button" className="sheet-cancel" onClick={closeSheet}>취소</button>
        </BottomSheet>
      )}
      {sheet === 'confirm' && (
        <BottomSheet title="이 사진을 삭제할까요?" onClose={closeSheet}>
          <p className="sheet-sub">삭제한 사진은 되돌릴 수 없어요</p>
          <button type="button" className="sheet-danger-btn" onClick={onDelete}>삭제</button>
          <button type="button" className="sheet-cancel" onClick={closeSheet}>취소</button>
        </BottomSheet>
      )}

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
        {memo.activity && <span className="pill">{memo.activity}</span>}
        {memo.place && <span className="pill p">{memo.place}</span>}
      </div>

      {/* Simple edition, family: pass the photo on (KakaoTalk, 이미지 저장). */}
      {canShare && (
        <div className="detail-share">
          <button className="share-btn" disabled={sharing} onClick={() => void onShare()}>공유하기</button>
        </div>
      )}

      <div className="detail-section">
        <div className="d-label">
          <span>메모</span>
          <span className="d-label-end">
            {rewriting
              ? <span className="src-badge tone-neutral">{serverDown ? '서버가 쉬는 중' : '다시 쓰는 중…'}</span>
              : memo.humanEdited
                ? <span className="src-badge tone-good">직접 작성</span>
                : badge && <span className={`src-badge tone-${badge.tone}`}>{badge.label}</span>}
            {actions.includes('edit') && !editing && (
              <button type="button" className="d-edit-link" disabled={saving} onClick={startEdit}>수정</button>
            )}
          </span>
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
