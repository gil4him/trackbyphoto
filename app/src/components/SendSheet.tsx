import { useState, type CSSProperties } from 'react'
import { BottomSheet } from './BottomSheet'
import { honorific } from '../lib/people'
import { tr } from '../lib/lang'

/** A parent this family member may send the photo to (부모님께 보내기). */
export interface SendTarget { uid: string; name: string; color: string; /** This photo already went to them. */ sent: boolean }

/**
 * ⋯ → 부모님께 보내기 on one's own photo (A14.3): pick the parent(s) when
 * more than one may receive it, an optional one-line message (60 at most,
 * kept as the family photo's caption), then 보내기. A parent who already has
 * this photo shows 보냄 and can't be picked: a photo goes to a parent once.
 */
export function SendSheet({ targets, busy = false, onSend, onClose }: {
  targets: SendTarget[]
  busy?: boolean
  onSend: (uids: string[], caption: string) => void
  onClose: () => void
}) {
  const open = targets.filter((t) => !t.sent)
  const [picked, setPicked] = useState<string[]>(() => (targets.length === 1 && open.length === 1 ? [open[0].uid] : []))
  const [message, setMessage] = useState('')
  const allSent = open.length === 0
  const one = targets.length === 1
  return (
    <BottomSheet
      title={one
        ? tr(`${honorific(targets[0].name)}께 이 사진을 보낼까요?`, `Send this photo to ${honorific(targets[0].name)}?`)
        : tr('누구에게 보낼까요?', 'Who should it go to?')}
      onClose={onClose}
    >
      <p className="sheet-sub">{tr('사진과 한 줄을 보내요. 장소는 보내지 않아요.', 'The photo and your line go over. The place stays here.')}</p>
      {one
        ? targets[0].sent && <p className="sheet-sub">{tr(`이미 ${honorific(targets[0].name)}께 보낸 사진이에요.`, `This photo already went to ${honorific(targets[0].name)}.`)}</p>
        : targets.map((t) => (
          <label key={t.uid} className={`send-pick${t.sent ? ' is-sent' : ''}`} style={{ '--pc': t.color } as CSSProperties}>
            <span className="dot" aria-hidden="true" />
            <span>{honorific(t.name)}</span>
            {t.sent
              ? <span className="done">{tr('보냄', 'Sent')}</span>
              : (
                <input
                  type="checkbox"
                  checked={picked.includes(t.uid)}
                  onChange={(e) => setPicked((cur) => e.target.checked ? [...cur, t.uid] : cur.filter((u) => u !== t.uid))}
                  style={{ marginLeft: 'auto' }}
                  aria-label={tr(`${honorific(t.name)}께 보내기`, `Send to ${honorific(t.name)}`)}
                />
              )}
          </label>
        ))}
      {!allSent && (
        <input
          className="send-message"
          type="text"
          maxLength={60}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={tr('한 줄 남기기 (선택)', 'Add a line (optional)')}
          aria-label={tr('한 줄 남기기 (선택)', 'Add a line (optional)')}
        />
      )}
      <button
        type="button"
        className="sheet-danger-btn send-go"
        disabled={picked.length === 0 || busy}
        onClick={() => onSend(picked.filter((u) => open.some((t) => t.uid === u)), message.trim().slice(0, 60))}
      >
        {allSent ? tr('이미 보냈어요', 'Already sent') : tr('보내기', 'Send')}
      </button>
      <button type="button" className="sheet-cancel" onClick={onClose}>{tr('취소', 'Cancel')}</button>
    </BottomSheet>
  )
}
