import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteField, doc, increment, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from '../components/Toast'
import { deleteMemo } from '../lib/capture'
import { fmtDate, fmtTime } from '../util'
import { categoryLabel, categoryThumbClass } from '../lib/categoryStyle'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import { Reactions, type ReactionsContext } from '../components/Reactions'
import { markRead } from '../lib/reactions'
import type { Memo, MemoSource } from '../types'
import { detailActions, type DetailAction } from '../lib/memoViews'
import { PlaceMap } from '../components/PlaceMap'
import { BottomSheet } from '../components/BottomSheet'
import { isSimple } from '../lib/edition'
import { sharePhoto } from '../lib/photoShare'
import { honorific } from '../lib/people'
import { SendSheet, type SendTarget } from '../components/SendSheet'
import { SEND_HINT_KEY, hintSeen, markHintSeen } from '../lib/hints'
import { tr } from '../lib/lang'
import { ZoomPhoto } from '../components/ZoomPhoto'
import { isTurned, pendingRotation, quarter, toggleTurn } from '../lib/photoRotate'

// 'stored-only' has no badge on purpose: nothing says a step was skipped.
const SOURCE_BADGES: Partial<Record<MemoSource, { label: string; tone: 'good' | 'neutral' | 'warn' }>> = {
  'foundation-models': { label: 'Apple Intelligence', tone: 'good' },
  'template':          { label: tr('iPhone 분석', 'iPhone'), tone: 'neutral' },
  'local-llm':         { label: tr('AI 분석', 'AI'), tone: 'good' },
  // Same words for the family: which model wrote it is not their concern.
  'cloud-llm':         { label: tr('AI 분석', 'AI'), tone: 'good' },
  'local-llm-v2':      { label: tr('AI 분석', 'AI'), tone: 'good' },
  'local-stub':        { label: tr('AI 추정', 'AI guess'), tone: 'warn' },
  'cloud-vision':      { label: tr('클라우드 AI', 'Cloud AI'), tone: 'good' },
  'cloud-stub':        { label: tr('클라우드 추정', 'Cloud guess'), tone: 'warn' },
  'human':             { label: tr('직접 작성', 'By family'), tone: 'good' },
}

const TITLE_MAX = 40
const BODY_MAX = 200

/**
 * One photo's record: the subject line, then a box with a few short
 * sentences, then the place. Family can correct the text by hand or ask the
 * worker to write it again from the photo.
 * `readOnly` (an elder's linked phone): no delete, no edit.
 * `canRotate` (the parent's own phone, the family's admin and guardian;
 * independent of readOnly): ↻ on the photo, saved for everyone.
 * The header holds back, the date and ⋯, which opens the actions (공유하기,
 * 수정, 다시 쓰기, 삭제) in a sheet.
 */
export interface SendTo {
  /** Who may receive it now (their family-photo settings and one's role). */
  targets: () => Promise<SendTarget[]>
  /** Send the photo (and an optional one-line message) to these parents. */
  send: (uids: string[], caption: string) => Promise<void>
}

export function MemoDetail({ memo, onBack, readOnly = false, canRotate = false, rx, sendTo }: { memo: Memo; onBack: () => void; readOnly?: boolean; /** ↻ 사진 돌리기 (owner decision, 2026-10-30). */ canRotate?: boolean; rx?: ReactionsContext; /** A family member's own photo: 부모님께 보내기. */ sendTo?: SendTo }) {
  const toast = useToast()
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Family opening the page has seen the parent's replies on this photo; the
  // parent opening their own photo has seen the family's hearts and words.
  const unseenReplies = rx?.canReact
    ? (rx.byMemo.get(memo.id) ?? []).filter((r) => r.actorUid === rx.patientUid && !r.readByFamilyAt && r.status === 'ready').map((r) => r.id).join(',')
    : ''
  const unseenByOwner = rx && !rx.canReact
    ? (rx.byMemo.get(memo.id) ?? []).filter((r) => r.actorUid !== rx.patientUid && !r.readByElderAt && r.status === 'ready').map((r) => r.id).join(',')
    : ''
  useEffect(() => {
    if (unseenReplies) markRead(unseenReplies.split(','), 'family')
  }, [unseenReplies])
  useEffect(() => {
    if (unseenByOwner) markRead(unseenByOwner.split(','), 'elder')
  }, [unseenByOwner])

  const takenAt = memo.takenAt.toDate()
  const badge = memo.memoSource ? SOURCE_BADGES[memo.memoSource] : null
  const grad = categoryThumbClass(memo.activity)
  // Pending with text already there means the worker is re-writing it.
  const rewriting = memo.status === 'pending' && !!memo.memo
  // The memo server is off or its model isn't answering: say so, don't spin.
  const serverDown = useWorkerStatus(memo.status === 'pending') === 'down'
  const waitingText = serverDown
    ? tr('메모 서버가 잠시 쉬고 있어요. 다시 켜지면 자동으로 써 드려요.', "The memo server is resting. We'll write this for you once it's back.")
    : tr('메모 작성 중…', 'Writing the memo…')
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
      toast.show(tr('제목을 입력해주세요', 'Please enter a title'), tr('비워둘 수 없어요', "It can't be empty"))
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
      toast.show(tr('메모를 저장했어요', 'Memo saved'), '')
    } catch (err) {
      console.error('[memo edit] failed', err)
      toast.show(tr('저장에 실패했어요', "Couldn't save"), tr('잠시 후 다시 시도해주세요', 'Please try again in a moment'))
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
      toast.show(tr('메모를 다시 쓰고 있어요', 'Writing the memo again'), tr('잠시만 기다려 주세요', 'Just a moment'))
    } catch (err) {
      console.error('[memo rewrite] failed', err)
      toast.show(tr('다시 쓰지 못했어요', "Couldn't rewrite it"), tr('잠시 후 다시 시도해주세요', 'Please try again in a moment'))
    } finally {
      setSaving(false)
    }
  }

  // The ⋯ sheet: its menu, or 삭제's confirmation in its place.
  const [sheet, setSheet] = useState<null | 'menu' | 'confirm' | 'send'>(null)
  const closeSheet = () => setSheet(null)

  const onDelete = () => {
    setSheet(null)
    deleteMemo({ memoId: memo.id, photoPath: memo.photoPath })
      .then(onBack)
      .catch((err) => {
        console.error(err)
        toast.show(tr('삭제에 실패했어요', "Couldn't delete it"), tr('잠시 후 다시 시도해주세요', 'Please try again in a moment'))
      })
  }

  // 지도에서 보기: the map opens here, under the place, never in another app.
  const located = typeof memo.lat === 'number' && typeof memo.lng === 'number'
  const [mapOpen, setMapOpen] = useState(false)

  const [sharing, setSharing] = useState(false)
  const passOn = async (run: () => Promise<unknown>) => {
    setSharing(true)
    try {
      await run()
    } catch (err) {
      console.error('[share] photo failed', err)
      toast.show(tr('사진을 보내지 못했어요', "Couldn't send the photo"), tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
    } finally {
      setSharing(false)
    }
  }
  // 사진 돌리기 is a toggle (owner decision, 2026-10-30): one tap turns the
  // photo 90° clockwise, the next turns it back; nothing cycles. The photo
  // turns here at once; taps within 1.2 s settle together (two cancel out)
  // and the odd one goes to the memo: memos.rotation (a pending request the
  // worker bakes into the stored photo, handlers/rotate.ts) and memos.turned
  // (how the stored photo now stands against the shot).
  const [localTaps, setLocalTaps] = useState(0)
  const unsent = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // `sent`: what this page wrote but Firestore has not echoed yet, so the
  // picture never jumps back in between. Any change to the memo's own
  // fields (the echo, or a turn made elsewhere) takes over from it.
  const [seen, setSeen] = useState({ rotation: memo.rotation, turned: memo.turned, sent: 0 })
  if (memo.rotation !== seen.rotation || memo.turned !== seen.turned) {
    setSeen({ rotation: memo.rotation, turned: memo.turned, sent: 0 })
  }
  // How the stored photo stands once what was sent lands.
  const standing = isTurned(memo) !== (seen.sent !== 0)
  const standingRef = useRef(standing)
  useEffect(() => { standingRef.current = standing })
  const memoId = memo.id
  const showToast = toast.show // stable; the context object is not
  const flushTurns = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const n = unsent.current
    unsent.current = 0
    setLocalTaps(0)
    if (n % 2 === 0) return
    const next = toggleTurn(standingRef.current)
    setSeen((s) => ({ ...s, sent: s.sent + next.deg }))
    updateDoc(doc(db, 'memos', memoId), { rotation: increment(next.deg), turned: next.turned ? 90 : deleteField() }).catch((err) => {
      // Firestore undoes its local copy of a refused write, which resets `sent`.
      console.error('[rotate] failed', err)
      showToast(tr('사진을 돌리지 못했어요 · 잠시 후 다시 시도해 주세요', "Couldn't rotate the photo · Please try again in a moment"))
    })
  }, [memoId, showToast])
  const turn = () => {
    unsent.current += 1
    setLocalTaps((n) => n + 1)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flushTurns, 1200)
  }
  // Leaving the page sends the taps still waiting.
  useEffect(() => flushTurns, [flushTurns])
  const tapped = localTaps % 2 === 1
  const rotation = quarter(pendingRotation(memo) + seen.sent + (tapped ? (standing ? -90 : 90) : 0))
  const turnedNow = standing !== tapped

  const onShare = () => passOn(() => sharePhoto(memo, rotation))

  // 부모님께 보내기: whom it may go to, then the photo alone to the ones picked.
  const [targets, setTargets] = useState<SendTarget[] | null>(null)
  // The first time on one's own photo: where sending lives.
  const [hint, setHint] = useState(() => !!sendTo && !hintSeen(SEND_HINT_KEY))
  const dismissHint = () => { if (hint) { markHintSeen(SEND_HINT_KEY); setHint(false) } }
  const openSend = async () => {
    setSheet(null)
    try {
      const list = await sendTo!.targets()
      if (list.length === 0) { toast.show(tr('사진을 받을 수 있는 부모님이 없어요', 'No parent can receive photos right now')); return }
      setTargets(list)
      setSheet('send')
    } catch (err) {
      console.error('[send] targets', err)
      toast.show(tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
    }
  }
  const onSend = async (uids: string[], caption: string) => {
    const to = (targets ?? []).filter((t) => uids.includes(t.uid) && !t.sent)
    if (to.length === 0) return
    setSheet(null)
    await passOn(async () => {
      await sendTo!.send(to.map((t) => t.uid), caption)
      toast.show(tr(`${to.map((t) => honorific(t.name)).join(', ')}에게 보냈어요`, `Sent to ${to.map((t) => honorific(t.name)).join(', ')}`))
    })
  }


  const actions = detailActions({
    simple: isSimple(), readOnly,
    hasPhoto: !!memo.photoUrl, hasMemo: !!memo.memo, rewriting, canSend: !!sendTo,
  })
  const ACTION_LABELS: Record<DetailAction, string> = {
    share: tr('공유하기', 'Share'),
    send: tr('부모님께 보내기', 'Send to parent'),
    edit: tr('직접 수정', 'Edit'),
    rewrite: tr('AI로 다시 쓰기', 'Rewrite'),
    delete: tr('지우기', 'Delete'),
  }
  const runAction = (a: DetailAction) => {
    if (a === 'delete') return setSheet('confirm')
    setSheet(null)
    if (a === 'share') void onShare()
    else if (a === 'send') void openSend()
    else if (a === 'edit') startEdit()
    else void rewrite()
  }

  return (
    <section className="page detail">
      <div className="detail-head">
        <button type="button" className="head-btn" onClick={onBack} aria-label={tr('뒤로가기', 'Back')}>‹</button>
        <div className="detail-head-when">{fmtDate(takenAt)} · {fmtTime(takenAt)}</div>
        {actions.length > 0
          ? <button type="button" className="head-btn" onClick={() => { dismissHint(); setSheet('menu') }} aria-label={tr('더보기', 'More')} aria-haspopup="dialog">⋯</button>
          : <span className="head-btn-space" aria-hidden="true" />}
        {hint && actions.includes('send') && (
          <button type="button" className="menu-hint" onClick={dismissHint}>{tr('여기서 부모님께 보낼 수 있어요', 'You can send this to your parent from here')}</button>
        )}
      </div>

      {sheet === 'menu' && (
        <BottomSheet onClose={closeSheet}>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={`sheet-item${a === 'delete' ? ' danger sep' : ''}`}
              disabled={a === 'share' || a === 'send' ? sharing : (a !== 'delete' && saving)}
              onClick={() => runAction(a)}
            >{ACTION_LABELS[a]}</button>
          ))}
          <button type="button" className="sheet-cancel" onClick={closeSheet}>{tr('취소', 'Cancel')}</button>
        </BottomSheet>
      )}
      {sheet === 'send' && targets && (
        <SendSheet targets={targets} busy={sharing} onSend={(uids, caption) => void onSend(uids, caption)} onClose={closeSheet} />
      )}
      {sheet === 'confirm' && (
        <BottomSheet title={tr('이 사진을 지울까요?', 'Delete this photo?')} onClose={closeSheet}>
          <p className="sheet-sub">{tr('지운 사진은 되돌릴 수 없어요', "A deleted photo can't come back")}</p>
          <button type="button" className="sheet-danger-btn" onClick={onDelete}>{tr('지우기', 'Delete')}</button>
          <button type="button" className="sheet-cancel" onClick={closeSheet}>{tr('취소', 'Cancel')}</button>
        </BottomSheet>
      )}

      {/* Photo header — falls back to a category-tinted gradient if no
          image yet (still uploading) so the review screen never goes blank. */}
      {memo.photoUrl
        ? <ZoomPhoto key={memo.id} src={memo.photoUrl} rotation={rotation} turned={turnedNow} canRotate={canRotate} onRotate={turn} />
        : (
          <div className={`detail-photo ${grad}`}>
            <div className="detail-photo-empty">{tr('사진을 불러오는 중…', 'Loading the photo…')}</div>
          </div>
        )}

      <div className="detail-memo">
        {memo.memo || (serverDown ? tr('메모를 기다리는 중이에요', 'Waiting for the memo') : tr('메모 작성 중…', 'Writing the memo…'))}
      </div>

      <div className="detail-meta">
        {memo.activity && <span className="pill">{categoryLabel(memo.activity)}</span>}
        {memo.place && <span className="pill p">{memo.place}</span>}
      </div>

      <div className="detail-section">
        <div className="d-label">
          <span>{tr('메모', 'Memo')}</span>
          <span className="d-label-end">
            {rewriting
              ? <span className="src-badge tone-neutral">{serverDown ? tr('서버가 쉬는 중', 'Server resting') : tr('다시 쓰는 중…', 'Rewriting…')}</span>
              : memo.humanEdited
                ? <span className="src-badge tone-good">{tr('직접 작성', 'By family')}</span>
                : badge && <span className={`src-badge tone-${badge.tone}`}>{badge.label}</span>}
            {actions.includes('edit') && !editing && (
              <button type="button" className="d-edit-link" disabled={saving} onClick={startEdit}>{tr('수정', 'Edit')}</button>
            )}
          </span>
        </div>
        {editing ? (
          <div className="d-edit">
            <label htmlFor="memo-title">{tr('제목', 'Title')}</label>
            <input
              id="memo-title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              maxLength={TITLE_MAX}
              autoFocus
            />
            <label htmlFor="memo-body">{tr('설명', 'Description')}</label>
            <textarea
              id="memo-body"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={3}
              maxLength={BODY_MAX}
            />
            <div className="d-edit-actions">
              <button className="d-btn-secondary" disabled={saving} onClick={() => setEditing(false)}>{tr('취소', 'Cancel')}</button>
              <button className="d-btn-primary" disabled={saving} onClick={saveEdit}>{saving ? tr('저장 중…', 'Saving…') : tr('저장', 'Save')}</button>
            </div>
          </div>
        ) : (
          <>
            {body
              ? <p className="d-scene">{body}</p>
              : <p className="d-scene muted">{memo.memo ? tr('설명이 아직 없어요.', 'No description yet.') : waitingText}</p>}
          </>
        )}
      </div>

      {/* Messages on a photo go to its owner: family write on a parent's
          photo; on one's own, it shows only what others have left. */}
      {rx && (rx.canReact || (rx.byMemo.get(memo.id)?.length ?? 0) > 0) && (
        <div className="detail-section rx-section">
          <div className="d-label"><span>{tr('가족 이야기', 'Family notes')}</span></div>
          <Reactions memoId={memo.id} ctx={rx} />
        </div>
      )}

      <div className="detail-section">
        <div className="d-label"><span>{tr('장소', 'Place')}</span></div>
        <div className="d-place">
          <div className="d-place-main">
            <span>📍 {memo.place || tr('위치 정보 없음', 'No location')}</span>
            {memo.address && <span className="d-address">{memo.address}</span>}
          </div>
          {located && (
            <button type="button" className="d-map-link" aria-expanded={mapOpen} onClick={() => setMapOpen((o) => !o)}>
              {mapOpen ? tr('지도 닫기', 'Hide map') : tr('지도에서 보기', 'See on the map')}
            </button>
          )}
        </div>
        {located && mapOpen && <PlaceMap point={{ lat: memo.lat as number, lng: memo.lng as number }} />}
      </div>
    </section>
  )
}
