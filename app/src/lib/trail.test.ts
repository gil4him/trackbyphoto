// 다녀온 곳: stops, distance from home, which map draws it.
import { describe, it, expect } from 'vitest'
import { AWAY_KM, distanceKm, fmtKm, homeFor, inferHome, project, trailStops, trailSummary } from './trail'
import { inKorea, pickProvider } from './map'
import { staticMapUrl } from './map/googleStatic'
import type { Memo } from '../types'

const HOME = { lat: 37.4837, lng: 127.0324 } // 서초동
const at = (h: number, m = 0) => ({ toMillis: () => Date.UTC(2026, 9, 3, h, m), toDate: () => new Date(Date.UTC(2026, 9, 3, h, m)) }) as Memo['takenAt']
const memo = (id: string, hour: number, lat: number | null, lng: number | null, place = ''): Memo =>
  ({ id, patientUid: 'p1', takenAt: at(hour), lat, lng, place, photoUrl: `https://example.test/${id}.jpg`, memo: id, status: 'ready' }) as unknown as Memo

// 공원 (1.2 km) → 시장 (2.0 km) → 집 → 카페 (0.8 km), entered out of order.
const DAY = [
  memo('cafe', 15, 37.4905, 127.0290, '카페 · 방배동, 서초구'),
  memo('park', 9, 37.4945, 127.0324, '서초동, 서초구'),
  memo('park2', 9, 37.4946, 127.0325, '서초동, 서초구'),
  memo('market', 11, 37.4837, 127.0551, '역삼동, 강남구'),
  memo('home', 12, 37.4838, 127.0324, ''),
  memo('nowhere', 13, null, null, ''),
]

describe('trailStops', () => {
  it('orders the located photos by time and joins photos taken in one place', () => {
    const stops = trailStops(DAY, HOME)
    expect(stops.map((s) => s.memos.map((m) => m.id))).toEqual([['park', 'park2'], ['market'], ['home'], ['cafe']])
    expect(stops.map((s) => s.area)).toEqual(['서초동', '역삼동', '', '방배동'])
    expect(stops.map((s) => Number(s.kmFromHome!.toFixed(1)))).toEqual([1.2, 2.0, 0.0, 0.8])
  })

  it('coming back to a place later is a new stop', () => {
    const stops = trailStops([memo('a', 9, 37.49, 127.03), memo('b', 10, 37.50, 127.05), memo('c', 11, 37.49, 127.03)], null)
    expect(stops).toHaveLength(3)
    expect(stops[0].kmFromHome).toBeNull()
  })
})

describe('trailSummary', () => {
  it('says how far from home the day went', () => {
    expect(trailSummary(trailStops(DAY, HOME))).toMatchObject({ away: false, text: '집에서 최대 2.0km' })
    expect(trailSummary(trailStops([memo('home', 12, 37.4838, 127.0324)], HOME)).text).toBe('집 근처')
  })

  it('marks a trip: every stop far from home', () => {
    const nagoya = trailStops([memo('a', 9, 35.1709, 136.8815), memo('b', 11, 35.1815, 136.9066)], HOME)
    const s = trailSummary(nagoya)
    expect(s.away).toBe(true)
    expect(s.maxKm!).toBeGreaterThan(AWAY_KM)
    expect(s.text).toMatch(/^집에서 약 \d{3}km$/)
  })

  it('says nothing about distance when home is not known', () => {
    expect(trailSummary(trailStops(DAY, null))).toEqual({ maxKm: null, away: false, text: '' })
    expect(trailSummary([])).toEqual({ maxKm: null, away: false, text: '' })
  })
})

describe('home', () => {
  it('is what family set, else where most photos are, else unknown', () => {
    expect(homeFor({ lat: 1, lng: 2 }, DAY)).toEqual({ lat: 1, lng: 2 })
    const inferred = homeFor(null, DAY)!
    expect(distanceKm(inferred, HOME)).toBeLessThan(2)
    expect(homeFor(undefined, DAY.slice(0, 3))).toBeNull()
    expect(inferHome([])).toBeNull()
  })

  it('formats distances the way the screens show them', () => {
    expect(fmtKm(0.05)).toBe('집 근처')
    expect(fmtKm(0.84)).toBe('0.8km')
    expect(fmtKm(2)).toBe('2.0km')
    expect(fmtKm(903.4)).toBe('903km')
    expect(fmtKm(8123)).toBe('8,123km')
  })
})

describe('project', () => {
  it('keeps the route inside the box, north up', () => {
    const xy = project(trailStops(DAY, HOME), 320, 200, 20)
    for (const p of xy) {
      expect(p.x).toBeGreaterThanOrEqual(20 - 0.01)
      expect(p.x).toBeLessThanOrEqual(300 + 0.01)
      expect(p.y).toBeGreaterThanOrEqual(20 - 0.01)
      expect(p.y).toBeLessThanOrEqual(180 + 0.01)
    }
    // The park is north of home, the market east of it.
    expect(xy[0].y).toBeLessThan(xy[2].y)
    expect(xy[1].x).toBeGreaterThan(xy[2].x)
  })

  it('puts a single place in the middle', () => {
    expect(project([HOME], 320, 200, 20)).toEqual([{ x: 160, y: 100 }])
    expect(project([], 320, 200, 20)).toEqual([])
  })
})

describe('map provider', () => {
  const SEOUL = [{ lat: 37.49, lng: 127.03 }, { lat: 37.50, lng: 127.05 }]
  const NAGOYA = [{ lat: 35.17, lng: 136.88 }]
  const BOTH = { kakao: 'k', google: 'g' }

  it('Korea uses Kakao; anywhere else uses Google', () => {
    expect(inKorea(SEOUL[0])).toBe(true)
    expect(inKorea({ lat: 33.5, lng: 126.5 })).toBe(true) // 제주
    expect(inKorea(NAGOYA[0])).toBe(false)
    expect(pickProvider(SEOUL, BOTH)).toBe('kakao')
    expect(pickProvider(NAGOYA, BOTH)).toBe('googleStatic')
    // A day that starts in Seoul and ends in Nagoya doesn't fit a Korean map.
    expect(pickProvider([...SEOUL, ...NAGOYA], BOTH)).toBe('googleStatic')
  })

  it('without the key for that area, the sketch is used', () => {
    expect(pickProvider(SEOUL, { google: 'g' })).toBe('sketch')
    expect(pickProvider(NAGOYA, { kakao: 'k' })).toBe('sketch')
    expect(pickProvider(SEOUL, {})).toBe('sketch')
    expect(pickProvider([], BOTH)).toBe('sketch')
  })

  it('builds a Google Static Maps link with the route and numbered pins', () => {
    const url = new URL(staticMapUrl([...SEOUL, ...NAGOYA], 'KEY'))
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/staticmap')
    expect(url.searchParams.get('key')).toBe('KEY')
    expect(url.searchParams.get('path')).toBe('color:0xFF6B2CFF|weight:4|37.49000,127.03000|37.50000,127.05000|35.17000,136.88000')
    expect(url.searchParams.getAll('markers')).toEqual([
      'color:0xFF6B2C|label:1|37.49000,127.03000', 'color:0xFF6B2C|label:2|37.50000,127.05000', 'color:0xFF6B2C|label:3|35.17000,136.88000',
    ])
    expect(new URL(staticMapUrl(NAGOYA, 'KEY')).searchParams.get('path')).toBeNull()
  })
})
