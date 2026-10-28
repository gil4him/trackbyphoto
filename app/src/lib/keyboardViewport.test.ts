// After the iPhone keyboard closes, the page is nudged back into line.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetViewportAfterKeyboard } from './keyboardViewport'

function fakeWindow() {
  const listeners: Array<() => void> = []
  const vv = {
    height: 800, offsetTop: 0,
    addEventListener: (_: string, fn: () => void) => { listeners.push(fn) },
    removeEventListener: (_: string, fn: () => void) => { listeners.splice(listeners.indexOf(fn), 1) },
  }
  const win = { innerHeight: 800, scrollX: 0, scrollY: 500, visualViewport: vv, scrollTo: vi.fn() }
  const resize = (height: number, offsetTop = vv.offsetTop) => { vv.height = height; vv.offsetTop = offsetTop; listeners.forEach((fn) => fn()) }
  return { win, vv, resize, listeners }
}

describe('the page after the keyboard', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('scrolls a pixel and back when the keyboard closes on a shifted page', () => {
    const { win, resize } = fakeWindow()
    resetViewportAfterKeyboard(win as unknown as Window)
    resize(450, 120)          // keyboard opens
    resize(800, 37)           // keyboard closes, the page stays shifted
    vi.advanceTimersByTime(350)
    expect(win.scrollTo.mock.calls).toEqual([[0, 501], [0, 500]])
  })

  it('leaves a page in line alone', () => {
    const { win, resize } = fakeWindow()
    resetViewportAfterKeyboard(win as unknown as Window)
    resize(450, 120)
    resize(800, 0)
    vi.advanceTimersByTime(350)
    expect(win.scrollTo).not.toHaveBeenCalled()
  })

  it('does nothing for a resize without the keyboard', () => {
    const { win, resize } = fakeWindow()
    resetViewportAfterKeyboard(win as unknown as Window)
    resize(790, 10)
    vi.advanceTimersByTime(350)
    expect(win.scrollTo).not.toHaveBeenCalled()
  })

  it('stops listening when removed', () => {
    const { win, listeners } = fakeWindow()
    const stop = resetViewportAfterKeyboard(win as unknown as Window)
    stop()
    expect(listeners).toHaveLength(0)
  })
})
