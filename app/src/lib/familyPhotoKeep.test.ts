import { describe, it, expect, vi } from 'vitest'
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: { Cache: 'CACHE' } }))
vi.mock('./gallery', () => ({ keepInPhotos: vi.fn() }))
import { keepsOnThisDevice, keptFileName, keptIds, rememberKept } from './familyPhotoKeep'

describe('keeping a family photo on the parent\'s phone', () => {
  it('names the file by when it was sent', () => {
    expect(keptFileName({ createdAtMs: new Date(2026, 9, 12, 21, 24).getTime() })).toBe('Daylie_가족_20261012_2124.jpg')
  })
  it('the phone app keeps it in the album, an Android browser downloads it, an iPhone browser leaves it', () => {
    expect(keepsOnThisDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)', false)).toBe('download')
    expect(keepsOnThisDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', false)).toBe('none')
    expect(keepsOnThisDevice('anything', true)).toBe('app')
  })
  it('remembers each photo once, newest last, capped', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    expect(keptIds(storage)).toEqual([])
    rememberKept('a', storage); rememberKept('b', storage); rememberKept('a', storage)
    expect(keptIds(storage)).toEqual(['b', 'a'])
    for (let i = 0; i < 400; i++) rememberKept(`p${i}`, storage)
    expect(keptIds(storage).length).toBe(300)
    expect(keptIds({ getItem: () => 'not json' })).toEqual([])
  })
})
