import { useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { COMMENT_MAX } from '../lib/reactions'
import { QUICK_REPLIES, S } from '../lib/strings'
import type { TextReplies } from '../types'
import { isSimple } from '../lib/edition'
import { tr } from '../lib/lang'

/**
 * The parent's written reply, shared by 가족 소식 and the family-photo viewer.
 * With typing on ('full', the default) the text box comes first with the
 * keyboard up, and the ready-made phrases sit underneath as one-tap
 * shortcuts; with 'quick' it is the phrases alone and no keyboard. In the
 * simple edition 'quick' ends with a 직접 쓰기 button that brings the text
 * box up, so a parent can still say something of their own.
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
  const [ownWords, setOwnWords] = useState(false)
  const typing = textMode === 'full' || ownWords
  const canOpenTyping = textMode === 'quick' && isSimple() && !ownWords
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const openTyping = () => {
    // Show the box and focus it inside this tap, so the keyboard opens.
    flushSync(() => setOwnWords(true))
    ref.current?.focus()
  }

  return (
    <section className="page news">
      <button className="elder-back" onClick={onBack}>{tr('‹ 뒤로', '‹ Back')}</button>
      <div className="news-from">{tr(`${to}에게`, `To ${to}`)}</div>
      <div className="news-text small">{S.elderReplyTextTitle}</div>
      {typing && (
        <form className="news-type" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onSend(draft) }}>
          <input
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={COMMENT_MAX}
            placeholder={S.elderReplyTextPlaceholder}
            aria-label={tr('답장 직접 쓰기', 'Write your own reply')}
            enterKeyHint="send"
            autoFocus
          />
          <button type="submit" disabled={!draft.trim()}>{tr('보내기', 'Send')}</button>
        </form>
      )}
      <div className={textMode === 'full' ? 'news-quick' : 'news-actions'}>
        {QUICK_REPLIES.map((q) => (
          <button key={q} className="news-btn" onClick={() => onSend(q)}>{q}</button>
        ))}
        {canOpenTyping && (
          <button className="news-btn" onClick={openTyping}>{S.elderReplyTypeOwn}</button>
        )}
      </div>
    </section>
  )
}
