// The 다녀온 곳 page and the digest's route preview, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {} }))
const renderKakaoMap = vi.fn(async () => {})
vi.mock('../lib/map/kakao', () => ({ renderKakaoMap: (...args: unknown[]) => renderKakaoMap(...(args as [])) }))

import { Trail } from './Trail'
import { DigestView } from './DigestPage'
import type { Digest, Memo } from '../types'

const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '')
const HOME = { lat: 37.4837, lng: 127.0324 }
const at = (h: number) => ({ toMillis: () => Date.UTC(2026, 9, 3, h), toDate: () => new Date(2026, 9, 3, h, 40) }) as Memo['takenAt']
const memo = (id: string, hour: number, lat: number | null, lng: number | null, place: string, text: string): Memo =>
  ({ id, patientUid: 'p1', takenAt: at(hour), lat, lng, place, photoUrl: `https://example.test/${id}.jpg`, memo: text, activity: '산책', status: 'ready' }) as unknown as Memo
const SEOUL_DAY = [
  memo('park', 9, 37.4945, 127.0324, '서초동, 서초구', '나무가 우거진 공원 산책길'),
  memo('market', 11, 37.4837, 127.0551, '역삼동, 강남구', '시장에서 장 보는 중이에요'),
  memo('noplace', 12, null, null, '', '된장찌개로 점심 식사'),
]
const NAGOYA_DAY = [memo('a', 9, 35.1709, 136.8815, '나고야', '나고야 시내 거리 구경'), memo('b', 11, 35.1815, 136.9066, '나고야', 'DAISO 매장 앞에서')]
const MAP_HOSTS = /dapi\.kakao\.com|maps\.googleapis\.com/

describe('Trail', () => {
  it('lists the stops in order with how far from home each was', () => {
    const out = render(<Trail title="오늘 다녀온 곳" memos={SEOUL_DAY} home={HOME} onBack={() => {}} onOpenMemo={() => {}} keys={{}} />)
    expect(out).toContain('오늘 다녀온 곳')
    expect(out).toContain('2곳 · 집에서 최대 2.0km')
    expect(out).toContain('나무가 우거진 공원 산책길')
    expect(out).toContain('집에서 1.2km')
    expect(out.indexOf('나무가 우거진 공원 산책길')).toBeLessThan(out.indexOf('시장에서 장 보는 중이에요'))
    expect(out).toContain('위치가 없는 사진 1장은 여기에 나오지 않아요.')
    expect(out).not.toContain('여행 중')
    // No key: the sketch, with the photos on the pins.
    expect(out).toContain('trail-sketch')
    expect(out).toContain('https://example.test/park.jpg')
    expect(out).not.toMatch(MAP_HOSTS)
  })

  it('shows 여행 중 far from home, and asks before fetching a Google map', () => {
    const out = render(<Trail title="오늘 다녀온 곳" memos={NAGOYA_DAY} home={HOME} onBack={() => {}} onOpenMemo={() => {}} keys={{ kakao: 'k', google: 'g' }} />)
    expect(out).toContain('여행 중')
    expect(out).toMatch(/집에서 약 \d{3}km/)
    expect(out).toContain('지도로 보기')
    // Until the tap, only the sketch: nothing is requested from Google.
    expect(out).toContain('trail-sketch')
    expect(out).not.toMatch(MAP_HOSTS)
  })

  it('in Korea with a key, leaves room for the Kakao map instead of the sketch', () => {
    const out = render(<Trail title="오늘 다녀온 곳" memos={SEOUL_DAY} home={HOME} onBack={() => {}} onOpenMemo={() => {}} keys={{ kakao: 'k' }} />)
    expect(out).toContain('trail-kakao')
    expect(out).not.toContain('trail-sketch')
    expect(out).not.toContain('지도로 보기')
  })

  it('says so when no photo of the day has a location', () => {
    const out = render(<Trail title="오늘 다녀온 곳" memos={[SEOUL_DAY[2]]} home={HOME} onBack={() => {}} onOpenMemo={() => {}} keys={{}} />)
    expect(out).toContain('위치가 기록된 사진이 없어요')
  })
})

describe('digest route preview', () => {
  const digest: Digest = {
    id: 'd1', patientUid: 'p1', patientName: '어머니', kind: 'daily', label: '10월 3일 토요일',
    summary: '오전에 공원을 산책하셨어요.', memoIds: ['park', 'market'], photoCount: 2,
    replies: { hearts: 0, voices: 0, transcripts: [] },
  }

  it('draws the route as a sketch and makes no map request', () => {
    const out = render(<DigestView digest={digest} memos={SEOUL_DAY} onOpenMemo={() => {}} onMore={() => {}} onOpenTrail={() => {}} />)
    expect(out).toContain('다녀온 곳 지도 보기')
    expect(out).toContain('trail-sketch')
    expect(out).toContain('서초동 → 역삼동')
    expect(out).not.toMatch(MAP_HOSTS)
    expect(renderKakaoMap).not.toHaveBeenCalled()
  })

  it('only lists the places while the map is not rolled out', () => {
    const out = render(<DigestView digest={digest} memos={SEOUL_DAY} onOpenMemo={() => {}} onMore={() => {}} />)
    expect(out).toContain('서초동 → 역삼동')
    expect(out).not.toContain('trail-sketch')
  })
})
