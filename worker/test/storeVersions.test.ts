// The stores' latest app versions (worker/src/storeVersions.ts): parsers, and
// what lands in system/app. The stores are injected fakes; Firestore is the emulator.

import { describe, it, expect, beforeEach } from 'vitest'
import { compareVersions, fetchAndroidVersion, parseItunesLookup, parsePlayTrack, refreshStoreVersions } from '../src/storeVersions'
import { db, clearFirestore } from './setup'

const systemApp = async () => (await db.doc('system/app').get()).data()

beforeEach(async () => {
  await clearFirestore()
})

describe('parsers', () => {
  it('reads the App Store version from an iTunes lookup', () => {
    expect(parseItunesLookup({ resultCount: 1, results: [{ version: '1.0.2', trackId: 6821605732 }] })).toBe('1.0.2')
    expect(parseItunesLookup({ resultCount: 0, results: [] })).toBeNull()
    expect(parseItunesLookup(null)).toBeNull()
  })

  it('reads the newest live production release from Play, whatever its name looks like', () => {
    expect(parsePlayTrack({ track: 'production', releases: [{ name: '29884623 (1.0.2)', status: 'completed', versionCodes: ['29884623'] }] })).toBe('1.0.2')
    expect(parsePlayTrack({ releases: [
      { name: '1.0.2', status: 'completed' },
      { name: '1.0.10', status: 'inProgress' },
      { name: '1.1.0', status: 'draft' },
      { name: '2.0.0', status: 'halted' },
    ] })).toBe('1.0.10')
    expect(parsePlayTrack({ releases: [{ name: '1.0', status: 'completed' }] })).toBe('1.0.0')
    expect(parsePlayTrack({ releases: [{ name: 'release', status: 'completed' }] })).toBeNull()
    expect(parsePlayTrack({ track: 'production' })).toBeNull()
  })

  it('compares versions number by number', () => {
    expect(compareVersions('1.0.2', '1.0.10')).toBeLessThan(0)
    expect(compareVersions('1.0.10', '1.0.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
  })

  it('reads Play through a throwaway edit and deletes it', async () => {
    const calls: string[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace(/^.*\/applications\//, '')}`)
      if (url.endsWith('/edits')) return new Response(JSON.stringify({ id: 'e1' }))
      if (url.endsWith('/tracks/production')) return new Response(JSON.stringify({ releases: [{ name: '1.0.3', status: 'completed' }] }))
      return new Response(null, { status: 204 })
    }) as typeof fetch
    process.env.PLAY_PACKAGE_NAME = 'com.zymer.daylie'
    try {
      expect(await fetchAndroidVersion(fake, async () => 't')).toBe('1.0.3')
    } finally {
      delete process.env.PLAY_PACKAGE_NAME
    }
    expect(calls).toEqual([
      'POST com.zymer.daylie/edits',
      'GET com.zymer.daylie/edits/e1/tracks/production',
      'DELETE com.zymer.daylie/edits/e1',
    ])
  })
})

describe('refreshStoreVersions', () => {
  it('writes what the stores say', async () => {
    await refreshStoreVersions({ ios: async () => '1.0.2', android: async () => '1.0.3' })
    expect(await systemApp()).toMatchObject({ ios: { version: '1.0.2', source: 'itunes' }, android: { version: '1.0.3', source: 'play' } })
    expect((await systemApp())?.ios.checkedAt).toBeTruthy()
  })

  it('an override in admin_config/app wins over the store', async () => {
    await db.doc('admin_config/app').set({ ios: '1.0.4' })
    await refreshStoreVersions({ ios: async () => '1.0.2', android: async () => '1.0.3' })
    expect(await systemApp()).toMatchObject({ ios: { version: '1.0.4', source: 'override' }, android: { version: '1.0.3', source: 'play' } })
  })

  it('a failed lookup keeps the last good value', async () => {
    await refreshStoreVersions({ ios: async () => '1.0.2', android: async () => '1.0.3' })
    await refreshStoreVersions({ ios: async () => { throw new Error('iTunes lookup 503') }, android: async () => null })
    expect(await systemApp()).toMatchObject({ ios: { version: '1.0.2', source: 'itunes' }, android: { version: '1.0.3', source: 'play' } })
  })

  it('writes nothing for a platform nobody knows', async () => {
    await refreshStoreVersions({ ios: async () => null })
    expect(await systemApp()).toBeUndefined()
    await refreshStoreVersions({ ios: async () => '1.0.2' })
    expect(await systemApp()).toEqual({ ios: expect.objectContaining({ version: '1.0.2' }) })
  })
})
