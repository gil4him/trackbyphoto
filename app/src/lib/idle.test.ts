import { describe, it, expect, vi } from 'vitest'
import { watchIdle } from './idle'

describe('watchIdle', () => {
  it('fires after the quiet spell, later when something is touched, never after stop', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const onIdle = vi.fn()
    const stop = watchIdle(target, 1000, onIdle)
    vi.advanceTimersByTime(900)
    target.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(900)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(onIdle).toHaveBeenCalledTimes(1)
    stop()
    const again = vi.fn()
    const stop2 = watchIdle(target, 1000, again)
    stop2()
    vi.advanceTimersByTime(2000)
    expect(again).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
