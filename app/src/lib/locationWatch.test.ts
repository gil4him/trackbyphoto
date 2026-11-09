import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { freshWhileVisible, WATCH_FOR_MS, type WatchDeps } from './locationWatch'

function fake(allowed = true) {
  let visible = true
  let listener: () => void = () => {}
  const stops: ReturnType<typeof vi.fn>[] = []
  const start = vi.fn(async () => { const s = vi.fn(); stops.push(s); return s })
  const deps: WatchDeps = {
    allowed: async () => allowed,
    start,
    visible: () => visible,
    onVisibility: (cb) => { listener = cb; return () => { listener = () => {} } },
  }
  const setVisible = async (v: boolean) => { visible = v; listener(); await flush() }
  return { deps, start, stops, setVisible }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('keeping the location fresh', () => {
  it('watches while the screen is in front, stops in the background, starts again on return', async () => {
    const f = fake()
    const stop = freshWhileVisible(f.deps)
    await flush()
    expect(f.start).toHaveBeenCalledTimes(1)
    await f.setVisible(false)
    expect(f.stops[0]).toHaveBeenCalled()
    await f.setVisible(true)
    expect(f.start).toHaveBeenCalledTimes(2)
    stop()
    expect(f.stops[1]).toHaveBeenCalled()
  })

  it('stops by itself after ten minutes and waits for the next return', async () => {
    const f = fake()
    freshWhileVisible(f.deps)
    await flush()
    await vi.advanceTimersByTimeAsync(WATCH_FOR_MS)
    expect(f.stops[0]).toHaveBeenCalled()
    expect(f.start).toHaveBeenCalledTimes(1)
    await f.setVisible(false)
    await f.setVisible(true)
    expect(f.start).toHaveBeenCalledTimes(2)
  })

  it('never starts (or asks) when location is not allowed yet', async () => {
    const f = fake(false)
    freshWhileVisible(f.deps)
    await flush()
    expect(f.start).not.toHaveBeenCalled()
  })

  it('a watch that starts after the screen closed is stopped at once', async () => {
    const f = fake()
    const stop = freshWhileVisible(f.deps)
    stop()
    await flush()
    expect(f.stops.every((s) => s.mock.calls.length === 1)).toBe(true)
  })
})
