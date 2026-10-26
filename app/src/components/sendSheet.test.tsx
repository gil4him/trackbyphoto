// ⋯ → 부모님께 보내기 on one's own photo (A14.3).
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { ReactNode } from 'react'

// The sheet's frame portals into the page; here only what it holds matters.
vi.mock('./BottomSheet', () => ({ BottomSheet: ({ title, children }: { title?: string; children: ReactNode }) => <div><h2>{title}</h2>{children}</div> }))
import { SendSheet, type SendTarget } from './SendSheet'

const t = (uid: string, name: string, sent = false): SendTarget => ({ uid, name, color: '#4A90D9', sent })
const html = (targets: SendTarget[]) => renderToString(<SendSheet targets={targets} onSend={() => {}} onClose={() => {}} />).replace(/<!-- -->/g, '')

describe('SendSheet', () => {
  it('one parent: asks to send to them, a one-line message (60 at most), and 보내기 ready', () => {
    const out = html([t('mom', '엄마')])
    expect(out).toContain('엄마께 이 사진을 보낼까요?')
    expect(out).toContain('placeholder="한 줄 남기기 (선택)"')
    expect(out).toContain('maxLength="60"')
    expect(out).toMatch(/<button type="button" class="sheet-danger-btn send-go">보내기<\/button>/)
  })
  it('several parents: pick who; one who already has it shows 보냄 and can\'t be picked; 보내기 waits for a pick', () => {
    const out = html([t('mom', '엄마', true), t('dad', '아빠')])
    expect(out).toContain('누구에게 보낼까요?')
    expect(out).toContain('<span class="done">보냄</span>')
    expect(out.match(/type="checkbox"/g)?.length).toBe(1)
    expect(out).toContain('aria-label="아빠께 보내기"')
    expect(out).toMatch(/send-go" disabled="">보내기/)
  })
  it('already sent to everyone: no message, and the button says why it is off', () => {
    const out = html([t('mom', '엄마', true)])
    expect(out).toContain('이미 엄마께 보낸 사진이에요.')
    expect(out).not.toContain('한 줄 남기기')
    expect(out).toMatch(/send-go" disabled="">이미 보냈어요/)
  })
})
