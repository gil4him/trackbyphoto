// The home screen, rendered without a browser: the stacked buttons, the
// sideways photo row and the parent's-home note about 사진 보내기.
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
  it('has no 사진 보내기 row and no help line under the buttons on one\'s own home', () => {
    const out = render()
    expect(out).not.toContain('사진 보내기')
    expect(out).not.toContain('기록돼요')
  })

  it('on a parent\'s home, points at the floating camera button for sending them a photo', () => {
    const out = render({ canCapture: false, canSendPhoto: true })
    expect(out).toContain('아래 카메라 버튼으로 승희님께 사진을 보내 드릴 수 있어요')
    expect(out).not.toContain('class="capbtn"')
    expect(render({ canCapture: false })).toContain('사진 찍기는 본인 계정에서만 가능해요')
  })

  it('puts the last 10 photos in one row and labels 지난 기록 on one line', () => {
    const out = render({ memos: Array.from({ length: 25 }, (_, i) => memo(i)), recordsLabel: true })
    expect(count(out, 'class="recent-thumb"')).toBe(10)
    expect(out).toContain('지난 기록 보기')
  })
})
