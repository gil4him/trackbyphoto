// The parent's reply screen: which ways to answer are offered.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/reactions', () => ({ COMMENT_MAX: 60, markRead: vi.fn(), sendElderComment: vi.fn(), sendElderHeart: vi.fn() }))
vi.mock('../lib/voiceOutbox', () => ({ sendVoice: vi.fn() }))
vi.mock('../lib/recorder', () => ({ canRecord: () => true, Mic: class {} }))

import { FamilyNews } from './FamilyNews'
import { ToastProvider } from '../components/Toast'
import { TextReply } from '../components/TextReply'
import { QUICK_REPLIES } from '../lib/strings'
import type { Reaction, TextReplies } from '../types'

const item: Reaction = { id: 'c1', memoId: 'm1', patientUid: 'p1', actorUid: 'cg1', actorName: '민수', kind: 'comment', text: '엄마 날씨 좋네요', status: 'ready', createdAtMs: 1_800_000_000_000 }
const html = (textMode?: TextReplies, voiceOn = true) => renderToString(
  <ToastProvider><FamilyNews uid="p1" patientName="어머니" item={item} unreadIds={[]} voiceOn={voiceOn} textMode={textMode} onDone={() => {}} /></ToastProvider>,
)

describe('FamilyNews', () => {
  it('offers a heart, voice and a written reply', () => {
    const out = html('quick')
    expect(out).toContain('엄마 날씨 좋네요')
    expect(out).toContain('❤️ 고마워요')
    expect(out).toContain('꾹 누르고 말하기')
    expect(out).toContain('글로 답장하기')
  })

  it('offers the written reply by default, and without voice', () => {
    const out = html(undefined, false)
    expect(out).toContain('글로 답장하기')
    expect(out).not.toContain('꾹 누르고 말하기')
  })

  it('leaves the written reply out when family switched it off', () => {
    expect(html('off')).not.toContain('글로 답장하기')
  })

  it('opens the written reply with a text box first, phrases underneath', () => {
    const out = renderToString(<TextReply to="민수" onBack={() => {}} onSend={() => {}} />)
    expect(out.replace(/<!-- -->/g, '')).toContain('민수에게')
    expect(out).toContain('aria-label="답장 직접 쓰기"')
    expect(out.indexOf('답장 직접 쓰기')).toBeLessThan(out.indexOf(QUICK_REPLIES[0]))
    for (const q of QUICK_REPLIES) expect(out).toContain(q)
  })

  it('offers only the phrases, no text box, when family chose 짧은 답장만', () => {
    const out = renderToString(<TextReply to="민수" textMode="quick" onBack={() => {}} onSend={() => {}} />)
    expect(out).not.toContain('답장 직접 쓰기')
    for (const q of QUICK_REPLIES) expect(out).toContain(q)
  })

  it('has a handful of short ready-made answers', () => {
    expect(QUICK_REPLIES.length).toBeGreaterThanOrEqual(4)
    expect(QUICK_REPLIES.length).toBeLessThanOrEqual(6)
    for (const q of QUICK_REPLIES) expect(q.length).toBeLessThanOrEqual(60)
  })
})
