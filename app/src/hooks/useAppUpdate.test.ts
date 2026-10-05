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
