// The memo detail page's header, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {} }))
vi.mock('../lib/capture', () => ({ deleteMemo: async () => {} }))

import { MemoDetail } from './MemoDetail'
import { ToastProvider } from '../components/Toast'
import type { Memo } from '../types'
import type { ReactionsContext } from '../components/Reactions'

const taken = new Date(2026, 9, 6, 14, 30)
const memo = {
  id: 'm1',
  patientUid: 'p1',
  photoUrl: 'https://example.test/m1.jpg',
  memo: '공원 산책길',
  place: '서초동, 서초구',
  address: '서울특별시 서초구 서초대로 1',
  status: 'ready',
  takenAt: { toDate: () => taken },
} as unknown as Memo

const render = () =>
  renderToString(<ToastProvider><MemoDetail memo={memo} onBack={() => {}} readOnly /></ToastProvider>).replace(/<!-- -->/g, '')

describe('MemoDetail', () => {
  it('shows the date and time together in the header', () => {
    expect(render()).toContain('<div class="detail-head-when">10월 6일 (화) · 오후 2:30</div>')
  })

  it('labels the memo box instead of repeating the date', () => {
    const out = render()
    expect(out).toContain('<div class="d-label"><span>메모</span>')
    expect(out.match(/10월 6일/g)?.length).toBe(1)
  })

  it('has no 공유하기 in the full edition', () => {
    const out = renderToString(<ToastProvider><MemoDetail memo={memo} onBack={() => {}} /></ToastProvider>)
    expect(out).not.toContain('공유하기')
    expect(out).toContain('aria-label="더보기"') // 수정 · 다시 쓰기 · 삭제
  })
})

describe('MemoDetail 가족 이야기', () => {
  const rx = (canReact: boolean, items: unknown[] = []) => ({
    byMemo: new Map([[memo.id, items]]), me: { uid: 'me', name: 'Shawn' }, patientUid: 'p1', patientName: '할아버지',
    canReact, voiceOn: false, voiceAllowed: false,
  }) as unknown as ReactionsContext
  const html = (ctx: ReactionsContext) =>
    renderToString(<ToastProvider><MemoDetail memo={memo} onBack={() => {}} rx={ctx} /></ToastProvider>)

  it('on a parent\'s photo: the box to write in', () => {
    const out = html(rx(true))
    expect(out).toContain('가족 이야기')
    expect(out).toContain('aria-label="글 남기기"')
  })

  it('on one\'s own photo with nothing left on it: no empty section', () => {
    expect(html(rx(false))).not.toContain('가족 이야기')
  })
})
