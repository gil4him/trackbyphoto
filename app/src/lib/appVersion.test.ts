// The parent's app version against the store's, and what family see about it.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }))
vi.mock('@capacitor/app', () => ({ App: { getInfo: vi.fn() } }))
vi.mock('../firebase', () => ({ db: {} }))
vi.mock('./storeLinks', () => ({ storeUrlFor: (kind: string) => (kind === 'ios' ? 'https://apps.apple.com/app/id6821605732' : 'https://play.google.com/store/apps/details?id=com.zymer.daylie') }))
vi.mock('./worker', () => ({ callWorker: vi.fn(), isWorkerOffline: () => false, WorkerError: class extends Error {}, WORKER_OFFLINE_MESSAGE: '' }))

import { appStatus, compareVersions, isBehind, nativeAppInfo, shouldReport, storeUrlForPlatform } from './appVersion'
import { buildStoreLinkMessage } from './share'
import type { ElderDevice } from '../types'

const DAY = 24 * 60 * 60 * 1000
const device = (over: Partial<ElderDevice>): ElderDevice => ({ id: 'd1', name: '아이폰', platform: 'ios', pairedAt: null, status: 'active', ...over })

describe('versions', () => {
  it('compares numerically', () => {
    expect(compareVersions('1.0.2', '1.0.10')).toBeLessThan(0)
    expect(compareVersions('1.1', '1.0.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })

  it('is behind only when both versions are known', () => {
    expect(isBehind('1.0.3', '1.0.4')).toBe(true)
    expect(isBehind('1.0.4', '1.0.4')).toBe(false)
    expect(isBehind(undefined, '1.0.4')).toBe(false)
    expect(isBehind('1.0.3', undefined)).toBe(false)
  })

  it('reports a new version at once, the same one once a day', () => {
    expect(shouldReport(null, '1.0.3', 0)).toBe(true)
    expect(shouldReport(`1.0.3:${DAY}`, '1.0.3', DAY + 1000)).toBe(false)
    expect(shouldReport(`1.0.3:${DAY}`, '1.0.3', 2 * DAY + 1)).toBe(true)
    expect(shouldReport(`1.0.3:${DAY}`, '1.0.4', DAY + 1000)).toBe(true)
    expect(shouldReport('garbage', '1.0.3', DAY)).toBe(true)
  })

  it('has no app version on the website', async () => {
    expect(await nativeAppInfo()).toBeNull()
  })

  it('opens the store of the phone', () => {
    expect(storeUrlForPlatform('ios')).toContain('apps.apple.com')
    expect(storeUrlForPlatform('android')).toContain('play.google.com')
    expect(storeUrlForPlatform('web')).toBeNull()
  })
})

describe('what family see', () => {
  const latest = { ios: '1.0.4', android: '1.0.3' }

  it('says nothing without a phone, or for a phone linked on the website', () => {
    expect(appStatus(undefined, latest)).toEqual({ kind: 'none' })
    expect(appStatus(device({ platform: 'web' }), latest)).toEqual({ kind: 'none' })
  })

  it('a phone from before 1.0.3 has no version', () => {
    expect(appStatus(device({}), latest)).toEqual({ kind: 'unknown', platform: 'ios' })
  })

  it('behind or current by its own store', () => {
    expect(appStatus(device({ app: { version: '1.0.3', platform: 'ios' } }), latest)).toEqual({ kind: 'behind', platform: 'ios', version: '1.0.3' })
    // Play has 1.0.3 already: the same version is current there.
    expect(appStatus(device({ platform: 'android', app: { version: '1.0.3', platform: 'android' } }), latest)).toEqual({ kind: 'current', platform: 'android', version: '1.0.3' })
    // The store's version is unknown: never "old".
    expect(appStatus(device({ app: { version: '1.0.3', platform: 'ios' } }), {})).toEqual({ kind: 'current', platform: 'ios', version: '1.0.3' })
  })

  it('the link message names the parent', () => {
    expect(buildStoreLinkMessage('엄마', 'https://apps.apple.com/app/id6821605732'))
      .toBe('[Daylie] 엄마 휴대폰의 Daylie 앱을 업데이트해 주세요.\nhttps://apps.apple.com/app/id6821605732')
  })
})
