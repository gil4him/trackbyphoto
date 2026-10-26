// 설치 (운영실 D11): the two store report parsers and the 30-day window that
// keeps what it read and never invents a day.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseSalesReport, ascMissing } from '../src/traffic/asc'
import { decodePlayCsv, parsePlayInstalls, playMissing } from '../src/traffic/play'
import { installs, resetTrafficThrottle, windowDates, type TrafficDeps } from '../src/traffic/index'

const SALES = [
  'Provider\tProvider Country\tSKU\tDeveloper\tTitle\tVersion\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tApple Identifier\tCustomer Price',
  'APPLE\tUS\tdaylie\tZymer\tDaylie\t1.0.1\t1F\t7\t0\t10/24/2026\t10/24/2026\tKRW\tKR\tKRW\t6751234567\t0',
  'APPLE\tUS\tdaylie\tZymer\tDaylie\t1.0.1\t1F\t2\t0\t10/24/2026\t10/24/2026\tUSD\tUS\tUSD\t6751234567\t0',
  'APPLE\tUS\tdaylie\tZymer\tDaylie\t1.0.1\t3F\t4\t0\t10/24/2026\t10/24/2026\tKRW\tKR\tKRW\t6751234567\t0',
  'APPLE\tUS\tdaylie\tZymer\tDaylie\t1.0.1\t7F\t11\t0\t10/24/2026\t10/24/2026\tKRW\tKR\tKRW\t6751234567\t0',
  'APPLE\tUS\tother\tZymer\tOther\t2.0\t1F\t5\t0\t10/24/2026\t10/24/2026\tKRW\tKR\tKRW\t6759999999\t0',
  '',
].join('\n')

const PLAY = [
  'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs,Install events,Update events,Uninstall events',
  '2026-10-01,com.zymer.daylie,3,0,0,40,3,0,38,3,0,0',
  '2026-10-02,com.zymer.daylie,5,1,0,45,4,1,41,5,0,1',
  '2026-10-02,com.zymer.daylie,1,0,0,46,1,0,42,1,0,0',
  '',
].join('\r\n')

describe('App Store sales report', () => {
  it('counts first downloads only (not re-downloads or updates), by country', () => {
    expect(parseSalesReport(SALES)).toEqual({ units: 14, byCountry: { KR: 12, US: 2 } })
  })
  it('keeps one app when the Apple ID is given', () => {
    expect(parseSalesReport(SALES, '6751234567')).toEqual({ units: 9, byCountry: { KR: 7, US: 2 } })
  })
  it('refuses something that is not a sales report', () => {
    expect(() => parseSalesReport('a\tb\n1\t2')).toThrow(/not a sales report/)
  })
  it('names the env values still missing', () => {
    expect(ascMissing()).toEqual(['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH', 'ASC_VENDOR_NUMBER'])
    expect(playMissing()).toEqual(['PLAY_REPORTS_BUCKET', 'PLAY_PACKAGE_NAME'])
  })
})

describe('Google Play installs report', () => {
  it('reads UTF-16LE with a BOM and adds up a day that appears twice', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(PLAY, 'utf16le')])
    expect(parsePlayInstalls(decodePlayCsv(buf))).toEqual({ '2026-10-01': 3, '2026-10-02': 5 })
  })
  it('reads plain UTF-8 too and refuses another report', () => {
    expect(parsePlayInstalls(decodePlayCsv(Buffer.from(PLAY)))['2026-10-01']).toBe(3)
    expect(() => parsePlayInstalls('Date,Package Name\n2026-10-01,x')).toThrow(/not an installs report/)
  })
})

describe('the 30-day window', () => {
  const NOW = Date.parse('2026-10-26T10:00:00Z')
  let stored: { ios?: Record<string, number>; android?: Record<string, number> }
  let saved: unknown[]
  let asked: string[]
  const deps = (over: Partial<TrafficDeps> = {}): TrafficDeps => ({
    now: NOW,
    ascMissing: () => [],
    playMissing: () => [],
    fetchAscDay: async (d) => { asked.push(`ios:${d}`); return d >= '2026-10-25' ? { ok: false, notYet: true } : { ok: true, units: 2, byCountry: { KR: 2 } } },
    fetchPlayMonth: async (m) => { asked.push(`android:${m}`); return m === '202610' ? { ok: true, days: { '2026-10-20': 3, '2026-10-21': 1 } } : { ok: false, notYet: true } },
    load: async () => stored,
    save: async (p) => { saved.push(p); Object.assign(stored, p) },
    ...over,
  })
  beforeEach(() => { stored = {}; saved = []; asked = []; resetTrafficThrottle() })

  it('ends yesterday and is 30 days long', () => {
    const w = windowDates(NOW)
    expect(w).toHaveLength(30)
    expect(w[0]).toBe('2026-09-26')
    expect(w.at(-1)).toBe('2026-10-25')
  })

  it('says which store is not connected, without asking anything', async () => {
    const r = await installs(deps({ ascMissing: () => ['ASC_KEY_ID'], playMissing: () => ['PLAY_REPORTS_BUCKET', 'PLAY_PACKAGE_NAME'] }))
    expect(r.ios).toMatchObject({ state: 'unconfigured', missing: ['ASC_KEY_ID'], total: 0, known: 0 })
    expect(r.android.state).toBe('unconfigured')
    expect(r.ios.days).toHaveLength(30)
    expect(r.ios.days.every((d) => d.n === null)).toBe(true)
    expect(asked).toEqual([])
    expect(saved).toEqual([])
  })

  it('reads the days it lacks, keeps them, and leaves days without a report null', async () => {
    const r = await installs(deps())
    expect(r.ios.state).toBe('ok')
    expect(r.ios.known).toBe(29)
    expect(r.ios.total).toBe(58)
    expect(r.ios.days.at(-1)).toEqual({ date: '2026-10-25', n: null })
    expect(r.android).toMatchObject({ state: 'ok', known: 2, total: 4 })
    expect(asked.filter((a) => a.startsWith('ios:'))).toHaveLength(30)
    expect(asked.filter((a) => a.startsWith('android:'))).toEqual(['android:202609', 'android:202610'])
    expect(saved).toHaveLength(1)
    expect(Object.keys(stored.ios!)).toHaveLength(29)

    // Next time: only the missing day is asked again, and not within 3 hours.
    asked = []
    const again = await installs(deps())
    expect(asked).toEqual([])
    expect(again.ios.total).toBe(58)
    asked = []
    await installs(deps({ now: NOW + 4 * 60 * 60_000 }))
    expect(asked).toEqual(['ios:2026-10-25', 'android:202609', 'android:202610'])
  })

  it('reports a store that answered badly, with what it had', async () => {
    stored = { ios: { '2026-10-01': 9 } }
    const r = await installs(deps({
      fetchAscDay: async () => ({ ok: false, notYet: false, error: 'App Store Connect 401' }),
      fetchPlayMonth: async () => ({ ok: false, notYet: false, error: 'Play 보고서 버킷 403 (서비스 계정에 Play Console 권한이 없어요)' }),
    }))
    expect(r.ios).toMatchObject({ state: 'error', error: 'App Store Connect 401', total: 9, known: 1 })
    expect(r.android.state).toBe('error')
    expect(r.android.error).toMatch(/403/)
  })
})
