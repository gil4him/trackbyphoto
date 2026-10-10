// A parent's phone updates itself, but never on the way back from the camera.
import { describe, it, expect } from 'vitest'
import { mayBeReturningFromCamera, noteCaptureStarted } from './useAppUpdate'

describe('self-update on a parent\'s phone', () => {
  it('holds off while a photo may be coming back from the camera', () => {
    expect(mayBeReturningFromCamera()).toBe(false)
    noteCaptureStarted()
    expect(mayBeReturningFromCamera()).toBe(true)
    expect(mayBeReturningFromCamera(Date.now() + 9 * 60_000)).toBe(true)
    expect(mayBeReturningFromCamera(Date.now() + 11 * 60_000)).toBe(false)
  })
})

describe('mayAutoReload', () => {
  it('lets a parent\'s phone reload by itself at most once every two minutes', async () => {
    const { mayAutoReload } = await import('./useAppUpdate')
    const m = new Map<string, string>()
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    expect(mayAutoReload(1_000_000, s)).toBe(true)
    expect(mayAutoReload(1_000_000 + 60_000, s)).toBe(false)
    expect(mayAutoReload(1_000_000 + 121_000, s)).toBe(true)
  })
})
