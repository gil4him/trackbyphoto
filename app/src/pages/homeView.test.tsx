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
vi.mock('../hooks/useWorkerStatus', () => ({ useWorkerStatus: () => 'up' }))

import { Home, ParentDayHome } from './Home'
import { ConnectParentCard } from '../components/ConnectParentCard'
import type { Reaction } from '../types'
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

describe("ParentDayHome (simple edition: the parent's day)", () => {
  const now = new Date(2026, 9, 4, 20, 0)
  const at = (h: number, mi: number, dayOffset = 0) => ({ toDate: () => new Date(2026, 9, 4 + dayOffset, h, mi) })
  const dayMemo = (id: string, h: number, mi: number, extra: Record<string, unknown> = {}) => ({
    id, patientUid: 'mom', photoPath: `photos/mom/${id}.jpg`, status: 'ready', memo: `${id} 메모`, activity: '산책', place: '석촌호수', lat: 37.5, lng: 127.0, takenAt: at(h, mi), ...extra,
  }) as unknown as Memo
  const render = (props: Partial<Parameters<typeof ParentDayHome>[0]> = {}) => renderToString(
    <ToastProvider>
      <ParentDayHome parentName="엄마" memos={[]} home={null} onOpen={() => {}} onYesterday={() => {}} now={now} {...props} />
    </ToastProvider>,
  ).replace(/<!-- -->/g, '')

  it('header: the date, 엄마의 하루, the count and how far from home', () => {
    const memos = [dayMemo('b', 15, 30, { lat: 37.518 }), dayMemo('a', 9, 5), dayMemo('old', 10, 0, { takenAt: at(10, 0, -1) })]
    const out = render({ memos, home: { lat: 37.5, lng: 127.0 } })
    expect(out).toContain('10월 4일 일요일')
    expect(out).toContain('엄마의 하루')
    expect(out).toContain('사진 2장 · 집에서 최대 2.0km')
    expect(render({ memos })).toContain('사진 2장<')
  })

  it("today's photos newest first on the rail, with the time, and nothing of the old home", () => {
    const memos = [dayMemo('b', 15, 30), dayMemo('a', 9, 5)]
    const byMemo = new Map<string, Reaction[]>([['b', [{ kind: 'heart', actorName: '지민' }, { kind: 'comment', actorName: '지민' }] as Reaction[]]])
    const out = render({ memos, byMemo })
    expect(count(out, 'class="day-card"')).toBe(2)
    expect(out.indexOf('b 메모')).toBeLessThan(out.indexOf('a 메모'))
    expect(out).toContain('15:30')
    expect(out).toContain('석촌호수 · 산책 · ♥ 지민 · 💬 1')
    expect(out).toContain('어제 보기 ›')
    expect(out).not.toContain('class="capbtn"')
    expect(out).not.toContain('지난 기록')
    expect(out).not.toContain('안녕하세요')
    expect(out).not.toContain('recent-strip')
  })

  it('no photo today: one dim card, still 어제 보기', () => {
    const out = render({ memos: [dayMemo('old', 10, 0, { takenAt: at(10, 0, -1) })] })
    expect(out).toContain('오늘 아직 사진이 없어요')
    expect(count(out, 'class="day-card"')).toBe(0)
    expect(out).toContain('사진 0장')
    expect(out).toContain('어제 보기 ›')
  })
})

describe('Home in the simple edition (one\'s own)', () => {
  it('has no 사진 찍기 or 지난 기록 button: the camera is the floating button', () => {
    const out = render({ simple: true, memos: [memo(1)] })
    expect(out).not.toContain('class="capbtn"')
    expect(out).not.toContain('class="askbtn"')
    expect(out).not.toContain('지난 기록')
    expect(out).toContain('안녕하세요')
    expect(out).toContain('class="recent-thumb"')
  })
})

describe("ParentDayHome: 사진 보내기 (simple edition)", () => {
  const now = new Date(2026, 9, 4, 20, 0)
  const render = (props: Partial<Parameters<typeof ParentDayHome>[0]> = {}) => renderToString(
    <ToastProvider>
      <ParentDayHome parentName="엄마" memos={[]} home={null} onOpen={() => {}} onYesterday={() => {}} now={now} {...props} />
    </ToastProvider>,
  ).replace(/<!-- -->/g, '')
  it('is an inline button under the day when the family may send, else absent', () => {
    expect(render({ onSendPhoto: () => {} })).toContain('aria-label="사진 보내기"')
    expect(render({ onSendPhoto: () => {} })).toContain('엄마님께 사진 보내기')
    expect(render()).not.toContain('사진 보내기')
  })
})

describe('Home with no parent yet (simple edition)', () => {
  it('shows only the connect card, with the big 엄마 연결하기 button', () => {
    const out = renderToString(
      <ToastProvider>
        <Home uid="me" patientName="지민" greetingName="지민" memos={[]} onOpenAsk={() => {}} onOpen={() => {}} connectOnly topCard={<ConnectParentCard onOpen={() => {}} />} />
      </ToastProvider>,
    )
    expect(out).toContain('class="connect-btn"')
    expect(out).toContain('엄마 연결하기')
    expect(out).toContain('connect-only')
    expect(out).not.toContain('class="capbtn"')
    expect(out).not.toContain('안녕하세요')
  })
})
