import { describe, it, expect, beforeEach, vi } from 'vitest'
import { recallSettings, rememberSettings } from './settingsCache'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  })
})

describe('settings remembered on the phone', () => {
  it('brings back the name, text size and reply mode for that person only', () => {
    rememberSettings('p1', { patientName: '할아버지', bigText: true, textReplies: 'quick', cadence: 'daily' })
    expect(recallSettings('p1')).toEqual({ patientName: '할아버지', bigText: true, textReplies: 'quick' })
    expect(recallSettings('p2')).toBeNull()
  })

  it('ignores anything that is not a setting it knows', () => {
    store.set('tbp.settings.p1', JSON.stringify({ patientName: 7, bigText: 'yes', textReplies: 'loud', plan: { tier: 'family' } }))
    expect(recallSettings('p1')).toBeNull()
    store.set('tbp.settings.p1', 'not json')
    expect(recallSettings('p1')).toBeNull()
  })

  it('does nothing, quietly, where the phone keeps no storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(() => rememberSettings('p1', { patientName: '엄마' })).not.toThrow()
    expect(recallSettings('p1')).toBeNull()
  })
})
