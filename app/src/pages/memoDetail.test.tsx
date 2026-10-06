// The memo detail page's header, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {} }))
vi.mock('../lib/capture', () => ({ deleteMemo: async () => {} }))

import { MemoDetail } from './MemoDetail'
import { ToastProvider } from '../components/Toast'
import type { Memo } from '../types'

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
  it('shows the date and time together in the pill', () => {
    expect(render()).toContain('<span class="pill t">10월 6일 (화) · 오후 2:30</span>')
  })

  it('labels the memo box instead of repeating the date', () => {
    const out = render()
    expect(out).toContain('<div class="d-label"><span>메모</span>')
    expect(out.match(/10월 6일/g)?.length).toBe(1)
  })
})
