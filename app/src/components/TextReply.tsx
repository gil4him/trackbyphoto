import { useState, type RefObject } from 'react'
import { COMMENT_MAX } from '../lib/reactions'
import { QUICK_REPLIES, S } from '../lib/strings'
import type { TextReplies } from '../types'

/**
 * The parent's written reply, shared by 가족 소식 and the family-photo viewer.
 * With typing on ('full', the default) the text box comes first with the
 * keyboard up, and the ready-made phrases sit underneath as one-tap
 * shortcuts; with 'quick' it is the phrases alone and no keyboard.
 */
export function TextReply({ to, textMode = 'full', inputRef, onBack, onSend }: {
  /** Who the reply goes to, e.g. 민수. */
  to: string
  textMode?: TextReplies
  /** Focused by the caller in the same tap that opened this panel, so the
   *  phone's keyboard comes up (iPhone ignores a focus that comes later). */
  inputRef?: RefObject<HTMLInputElement | null>
  onBack: () => void
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const typing = textMode === 'full'

  return (
    <section className="page news">
      <button className="elder-back" onClick={onBack}>‹ 뒤로</button>
      <div className="news-from">{to}에게</div>
      <div className="news-text small">{S.elderReplyTextTitle}</div>
      {typing && (
        <form className="news-type" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onSend(draft) }}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={COMMENT_MAX}
            placeholder={S.elderReplyTextPlaceholder}
            aria-label="답장 직접 쓰기"
            enterKeyHint="send"
            autoFocus
          />
          <button type="submit" disabled={!draft.trim()}>보내기</button>
        </form>
      )}
      <div className={typing ? 'news-quick' : 'news-actions'}>
        {QUICK_REPLIES.map((q) => (
          <button key={q} className="news-btn" onClick={() => onSend(q)}>{q}</button>
        ))}
      </div>
    </section>
  )
}
