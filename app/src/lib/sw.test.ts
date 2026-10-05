// Reloading into the newest version: wait for it to be on the phone first.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const native = vi.hoisted(() => ({ value: false }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))

import { reloadToLatest } from './sw'

function worker(state: string) {
  const listeners: Array<() => void> = []
  const w = {
    state,
    addEventListener: (_: string, fn: () => void) => { listeners.push(fn) },
    become: (next: string) => { w.state = next; listeners.forEach((fn) => fn()) },
  }
  return w
}

let reload: ReturnType<typeof vi.fn>
let registration: { update: ReturnType<typeof vi.fn>; installing?: unknown; waiting?: unknown } | undefined

beforeEach(() => {
  native.value = false
  reload = vi.fn()
  registration = undefined
  vi.stubGlobal('window', { location: { reload } })
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('reloadToLatest', () => {
  it('fetches the new version and reloads only once it has taken over', async () => {
    const incoming = worker('installing')
    registration = { update: vi.fn(async () => { registration!.installing = incoming }) }
    const done = reloadToLatest()
    await vi.waitFor(() => expect(registration!.update).toHaveBeenCalled())
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
    incoming.become('installed')
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
    incoming.become('activated')
    await done
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not wait forever for a version that never finishes arriving', async () => {
    vi.useFakeTimers()
    registration = { update: vi.fn(async () => {}), waiting: worker('installed') }
    const done = reloadToLatest()
    await vi.advanceTimersByTimeAsync(10_000)
    await done
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('just reloads when nothing new is on its way, or the check fails', async () => {
    registration = { update: vi.fn(async () => {}) }
    await reloadToLatest()
    registration = { update: vi.fn(async () => { throw new Error('offline') }) }
    await reloadToLatest()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('just reloads in the installed apps, which have no cache of their own', async () => {
    native.value = true
    registration = { update: vi.fn() }
    await reloadToLatest()
    expect(registration.update).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
