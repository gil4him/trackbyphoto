// The home screen, rendered without a browser: the stacked buttons, the
// sideways photo row and 사진 보내기 on one's own home.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/capture', () => ({ savePhoto: vi.fn(), captureNativePhoto: vi.fn(), isNativeApp: false }))
vi.mock('../lib/location', () => ({ warmUpLocation: vi.fn() }))
vi.mock('../hooks/useOutbox', () => ({ useOutbox: () => [] }))
vi.mock('../hooks/useAppUpdate', () => ({ noteCaptureStarted: vi.fn() }))
vi.mock('../components/MemoThumb', () => ({ MemoThumb: () => <span className="tl-thumb" /> }))

import { Home } from './Home'
import { ToastProvider } from '../components/Toast'
import type { Memo } from '../types'

const memo = (i: number) => ({ id: `m${i}`, patientUid: 'me', photoPath: `photos/me/${i}.jpg`, status: 'ready' }) as unknown as Memo
const render = (props: Partial<Parameters<typeof Home>[0]> = {}) => renderToString(
  <ToastProvider>
    <Home uid="me" patientName="승희" greetingName="승희" memos={[]} onOpenAsk={() => {}} onOpen={() => {}} {...props} />
  </ToastProvider>,
).replace(/<!-- -->/g, '')
const count = (html: string, s: string) => html.split(s).length - 1

describe('Home', () => {
  it('offers 사진 보내기 for each parent on one\'s own home, and says the camera is for one\'s own record', () => {
    const out = render({ sendTargets: [{ uid: 'p1', name: '아버지' }, { uid: 'p2', name: '어머니' }], onSendTo: () => {} })
    expect(out).toContain('아버지님께 사진 보내기')
    expect(out).toContain('어머니님께 사진 보내기')
    expect(out).toContain('내 기록으로 저장돼요')
  })

  it('folds three or more parents into one button', () => {
    const out = render({ sendTargets: [{ uid: 'a', name: '가' }, { uid: 'b', name: '나' }, { uid: 'c', name: '다' }], onSendTo: () => {} })
    expect(out).toContain('부모님께 사진 보내기')
    expect(out).not.toContain('가님께 사진 보내기')
  })

  it('shows no send button without parents, and the usual help line', () => {
    const out = render()
    expect(out).not.toContain('사진 보내기')
    expect(out).toContain('자동으로 기록돼요')
  })

  it('puts the last 10 photos in one row and labels 지난 기록 on one line', () => {
    const out = render({ memos: Array.from({ length: 25 }, (_, i) => memo(i)), recordsLabel: true })
    expect(count(out, 'class="recent-thumb"')).toBe(10)
    expect(out).toContain('지난 기록 보기')
  })
})
