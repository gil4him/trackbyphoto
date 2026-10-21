// The parent's written reply: phrases, and in the simple edition a way to type.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const edition = vi.hoisted(() => ({ simple: true }))
vi.mock('../lib/edition', () => ({ isSimple: () => edition.simple, EDITION: 'simple' }))
vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))

import { TextReply } from './TextReply'
import type { TextReplies } from '../types'

const render = (textMode: TextReplies) => renderToString(<TextReply to="민수" textMode={textMode} onBack={() => {}} onSend={() => {}} />)

describe('TextReply', () => {
  it('simple, phrases only: ends with 직접 쓰기 and no text box yet', () => {
    edition.simple = true
    const html = render('quick')
    expect(html).toContain('✏️ 직접 쓰기')
    expect(html).toContain('>고마워<')
    expect(html).not.toContain('<input')
  })
  it('full edition, phrases only: no keyboard at all, as 설정 promises', () => {
    edition.simple = false
    const html = render('quick')
    expect(html).not.toContain('직접 쓰기')
    expect(html).not.toContain('<input')
  })
  it('typing on: the text box first, no extra button', () => {
    edition.simple = true
    const html = render('full')
    expect(html).toContain('<input')
    expect(html).not.toContain('✏️ 직접 쓰기')
  })
})
