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
vi.mock('../lib/familyPhotos', () => ({ removeFamilyPhoto: vi.fn(async () => {}), sendFamilyPhoto: vi.fn(async () => {}) }))

import { Home, ParentDayHome } from './Home'
import { ConnectParentCard } from '../components/ConnectParentCard'
import { SentFamilyPhotos } from '../components/SendFamilyPhoto'
import type { AppNotification, FamilyPhoto, Reaction } from '../types'
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
  const at = (h: number, mi: number, dayOffset = 0) => { const d = new Date(2026, 9, 4 + dayOffset, h, mi); return { toDate: () => d, toMillis: () => d.getTime() } }
  const HOME = { lat: 37.5, lng: 127.0 }
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

  it("today's photos newest first on the rail, numbered from the day's first, and nothing of the old home", () => {
    const memos = [dayMemo('b', 15, 30), dayMemo('a', 9, 5)]
    const byMemo = new Map<string, Reaction[]>([['b', [{ kind: 'heart', actorName: '지민' }, { kind: 'comment', actorName: '지민' }] as Reaction[]]])
    const out = render({ memos, byMemo })
    expect(count(out, 'class="memo-row"')).toBe(2)
    expect(out.indexOf('b 메모')).toBeLessThan(out.indexOf('a 메모'))
    expect(out).toContain('15:30')
    expect(out).toContain('class="day-rail"')
    // The badge counts from the first photo of the day: b (newest) is 2.
    const b = out.slice(out.indexOf('<li>'), out.indexOf('b 메모'))
    expect(b).toContain('<span class="memo-row-badge" aria-hidden="true">2</span>')
    expect(out.slice(out.indexOf('b 메모'))).toContain('<span class="memo-row-badge" aria-hidden="true">1</span>')
    expect(out).toContain('석촌호수 · 산책 · ♥ 지민 · 💬 1')
    expect(out).toContain('어제 보기 ›')
    expect(out).not.toContain('day-card')
    expect(out).not.toContain('class="capbtn"')
    expect(out).not.toContain('지난 기록')
    expect(out).not.toContain('안녕하세요')
    expect(out).not.toContain('recent-strip')
  })

  it('다녀온 곳: the small map between the caption and the timeline once a photo today has a location', () => {
    const memos = [dayMemo('b', 15, 30, { lat: 37.518, place: '어린이대공원 · 능동, 광진구' }), dayMemo('a', 9, 5, { place: '석촌호수 · 잠실동, 송파구' })]
    const out = render({ memos, home: HOME, onOpenTrail: () => {} })
    expect(out).toContain('class="day-map"')
    expect(out).toContain('aria-label="다녀온 곳 2곳 보기"')
    expect(out).toContain('다녀온 곳 2 ›')
    // Before the box is on screen: the keyless sketch, no map request.
    expect(out).toContain('trail-sketch')
    expect(out).not.toContain('day-map-kakao')
    expect(out).not.toMatch(/dapi\.kakao\.com|maps\.googleapis\.com/)
    expect(out).not.toContain('여행 중')
    expect(out.indexOf('day-map')).toBeGreaterThan(out.indexOf('day-caption'))
    expect(out.indexOf('day-map')).toBeLessThan(out.indexOf('day-tl'))
    expect(out).toContain('사진 2장 · 집에서 최대 2.0km')
    expect(out).not.toContain('day-trail')
  })

  it('no map without the trail map, without a located photo, or with no photo today', () => {
    const memos = [dayMemo('a', 9, 5, { place: '석촌호수 · 잠실동, 송파구' })]
    expect(render({ memos, home: HOME })).not.toContain('다녀온 곳')
    expect(render({ memos: [dayMemo('a', 9, 5, { lat: null, lng: null })], onOpenTrail: () => {} })).not.toContain('day-map')
    const empty = render({ memos: [dayMemo('old', 10, 0, { takenAt: at(10, 0, -1) })], onOpenTrail: () => {} })
    expect(empty).not.toContain('day-map')
    expect(empty).toContain('오늘 아직 사진이 없어요')
  })

  it('far from home: 여행 중 on the pill; the sketch keeps home out of the picture', () => {
    const trip = render({ memos: [dayMemo('t', 12, 0, { lat: 35.17, lng: 136.88, place: '나고야' })], home: HOME, onOpenTrail: () => {} })
    expect(trip).toContain('여행 중')
    expect(trip).toContain('다녀온 곳 1 ›')
    expect(trip).not.toContain('>집<')
    const near = render({ memos: [dayMemo('h', 12, 0)], home: HOME, onOpenTrail: () => {} })
    expect(near).toContain('>집<')
    expect(near).not.toContain('여행 중')
  })

  it('no photo today: one dim card, still 어제 보기', () => {
    const out = render({ memos: [dayMemo('old', 10, 0, { takenAt: at(10, 0, -1) })] })
    expect(out).toContain('오늘 아직 사진이 없어요')
    expect(count(out, 'class="memo-row"')).toBe(0)
    expect(out).toContain('사진 0장')
    expect(out).toContain('어제 보기 ›')
  })
})

describe("Home in the simple edition: the family dashboard (A10)", () => {
  const now = new Date(2026, 9, 4, 20, 0)
  const at = (h: number, mi: number, dayOffset = 0) => { const d = new Date(2026, 9, 4 + dayOffset, h, mi); return { toDate: () => d, toMillis: () => d.getTime() } }
  const pm = (uid: string, id: string, h: number, mi: number, dayOffset = 0) => ({ id, patientUid: uid, photoPath: `photos/${uid}/${id}.jpg`, status: 'ready', memo: `${id} 메모`, activity: '산책', place: '석촌호수', takenAt: at(h, mi, dayOffset) }) as unknown as Memo
  const notice = (patientUid: string, message: string, h: number, mi: number) => ({ id: `n-${patientUid}`, recipientUid: 'me', patientUid, actorUid: patientUid, type: 'photo.new', message, read: false, createdAt: at(h, mi) }) as unknown as AppNotification
  const mom = { uid: 'mom', name: '엄마', memos: [pm('mom', 'c', 15, 30), pm('mom', 'b', 10, 10), pm('mom', 'a', 8, 0), pm('mom', 'z', 9, 0, -1)] }
  const dad = { uid: 'dad', name: '아빠', memos: [pm('dad', 'y1', 16, 0, -1), pm('dad', 'y2', 9, 0, -1)] }
  const render = (props: Partial<Parameters<typeof Home>[0]> = {}) => renderToString(
    <ToastProvider>
      <Home uid="me" patientName="지민" greetingName="지민" memos={[]} onOpenAsk={() => {}} onOpen={() => {}} simple now={now} {...props} />
    </ToastProvider>,
  ).replace(/<!-- -->/g, '')

  it('keeps the date and the greeting, and has no 사진 찍기 / 지난 기록 buttons, no notice banner, no old photo row', () => {
    const out = render({ parents: [mom], notifications: [notice('mom', '엄마님이 새 사진을 올렸어요', 15, 31)] })
    expect(out).toContain('10월 4일 (일)')
    expect(out).toContain('지민님, 안녕하세요')
    expect(out).not.toContain('class="capbtn"')
    expect(out).not.toContain('class="askbtn"')
    expect(out).not.toContain('지난 기록')
    expect(out).not.toContain('notice-stack')
    expect(out).not.toContain('recent-strip')
    expect(out).not.toContain('오늘 하루를 기록해요')
  })

  it("one card per parent: 엄마의 하루, today's count and last time, today's thumbnails in a strip, 보기 ›, no buttons inside", () => {
    const out = render({ parents: [mom] })
    expect(count(out, 'class="patient-card"')).toBe(1)
    expect(out).toContain('엄마의 하루')
    expect(out).not.toContain('엄마님')
    expect(out).toContain('사진 3장 · 마지막 오후 3:30')
    expect(count(out, 'class="pc-thumb"')).toBe(3)
    expect(out).toContain('보기 ›')
    expect(out).not.toContain('pc-news')
    const card = out.slice(out.indexOf('<button type="button" class="patient-card"'), out.indexOf('class="mine"'))
    expect(card.match(/<button/g)?.length).toBe(1)
  })

  it('the strip shows every photo of the day (up to twelve), not just three', () => {
    const busy = { ...mom, memos: [pm('mom', 'e', 17, 0), pm('mom', 'd', 16, 0), ...mom.memos] }
    expect(count(render({ parents: [busy] }), 'class="pc-thumb"')).toBe(5)
  })

  it('새 소식 only while something is unread, re-addressed: 엄마가 새 사진을 올렸어요 · the time', () => {
    const out = render({ parents: [{ ...mom, unread: notice('mom', '엄마님이 새 사진을 올렸어요', 15, 31) }] })
    expect(out).toContain('class="pc-pill"')
    expect(out).toContain('새 소식')
    expect(out).toContain('엄마가 새 사진을 올렸어요')
    expect(out).toContain('오후 3:31')
  })

  it("a quiet parent: the dim line with yesterday's count; two parents newest activity first", () => {
    const out = render({ parents: [dad, mom] })
    expect(count(out, 'class="patient-card"')).toBe(2)
    expect(out).toContain('오늘 아직 사진이 없어요 · 어제 사진 2장')
    expect(out.indexOf('엄마의 하루')).toBeLessThan(out.indexOf('아빠의 하루'))
    const quiet = render({ parents: [{ ...dad, memos: [] }] })
    expect(quiet).toContain('오늘 아직 사진이 없어요<')
    expect(quiet).not.toContain('어제 사진')
  })

  it('내 오늘: the photos taken today as 52px squares, then the dashed camera square; none → the square and 카메라 버튼으로 남겨요', () => {
    const mine = [pm('me', 'm2', 12, 0), pm('me', 'm1', 9, 0), pm('me', 'old', 9, 0, -1)]
    const out = render({ parents: [mom], memos: mine })
    expect(out).toContain('내 오늘 · 사진 2장')
    expect(count(out, 'class="mine-thumb"')).toBe(2)
    expect(out).toContain('class="mine-add"')
    expect(out).not.toContain('카메라 버튼으로 남겨요')
    const none = render({ parents: [mom] })
    expect(none).toContain('내 오늘 · 사진 0장')
    expect(none).toContain('class="mine-add"')
    expect(none).toContain('카메라 버튼으로 남겨요')
  })
})

describe("the 보낸 사진 row at the end of the parent's day (A10)", () => {
  const photo = (id: string) => ({ id, patientUid: 'mom', senderUid: 'me', senderName: '지민', photoPath: `familyPhotos/mom/${id}.jpg`, photoUrl: `https://x/${id}.jpg`, caption: '보고 싶어요', status: 'ready', createdAtMs: Date.UTC(2026, 9, 4, 11) }) as unknown as FamilyPhoto
  const render = (el: React.ReactNode) => renderToString(<ToastProvider>{el}</ToastProvider>).replace(/<!-- -->/g, '')

  it('the day page has no 사진 보내기 button of its own any more', () => {
    const now = new Date(2026, 9, 4, 20, 0)
    const out = render(<ParentDayHome parentName="엄마" memos={[]} home={null} onOpen={() => {}} onYesterday={() => {}} now={now} />)
    expect(out).not.toContain('day-send')
    expect(out).not.toContain('사진 보내기')
  })

  it('headed: 보낸 사진 · n장 with the 📷 사진 보내기 › link when the family may send; the line when nothing was sent', () => {
    const out = render(<SentFamilyPhotos photos={[photo('1'), photo('2')]} myUid="me" headed onSend={() => {}} />)
    expect(out).toContain('보낸 사진 · 2장')
    expect(out).toContain('class="fp-send-link"')
    expect(out).toContain('📷 사진 보내기 ›')
    expect(count(out, 'class="fp-row"')).toBe(2)
    expect(out).not.toContain('아직 보낸 사진이 없어요')
    const empty = render(<SentFamilyPhotos photos={[]} myUid="me" headed onSend={() => {}} />)
    expect(empty).toContain('보낸 사진 · 0장')
    expect(empty).toContain('아직 보낸 사진이 없어요')
    expect(render(<SentFamilyPhotos photos={[]} myUid="me" headed />)).not.toContain('사진 보내기')
  })

  it('without the header (the full edition), the list is silent when empty, as before', () => {
    expect(render(<SentFamilyPhotos photos={[]} myUid="me" />)).not.toContain('fp-sent')
    expect(render(<SentFamilyPhotos photos={[photo('1')]} myUid="me" />)).toContain('보낸 사진')
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
