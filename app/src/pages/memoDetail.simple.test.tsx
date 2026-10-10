// 공유하기 under a photo, the rest under ⋯: the family's view in the simple edition only.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/edition', () => ({ isSimple: () => true, EDITION: 'simple' }))
vi.mock('../firebase', () => ({ db: {}, auth: {} }))
vi.mock('../lib/capture', () => ({ deleteMemo: async () => {} }))
vi.mock('../lib/photoShare', () => ({ sharePhoto: vi.fn(), downloadPhoto: vi.fn() }))

import { MemoDetail } from './MemoDetail'
import { ToastProvider } from '../components/Toast'
import type { Memo } from '../types'

const memo = {
  id: 'm1', patientUid: 'p1', photoUrl: 'https://example.test/m1.jpg', memo: '공원 산책길', place: '서초동',
  status: 'ready', takenAt: { toDate: () => new Date(2026, 9, 6, 14, 30) },
} as unknown as Memo

const render = (readOnly: boolean) =>
  renderToString(<ToastProvider><MemoDetail memo={memo} onBack={() => {}} readOnly={readOnly} /></ToastProvider>)

describe('MemoDetail (simple)', () => {
  it('lets the family share the photo, with the rest under ⋯', () => {
    const html = render(false)
    expect(html).toContain('공유하기')
    expect(html).toContain('aria-label="더보기"')
    expect(html).not.toContain('사진 저장') // in the closed sheet
  })

  it('shows nothing of it on the parent\'s phone: back and the date only', () => {
    const html = render(true)
    expect(html).not.toContain('공유하기')
    expect(html).not.toContain('더보기')
    expect(html).toContain('aria-label="뒤로가기"')
  })
})
