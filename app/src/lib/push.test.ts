// Push in the installed apps (the website's path needs a real browser).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const native = vi.hoisted(() => ({
  platform: 'android',
  permission: 'prompt' as 'prompt' | 'granted' | 'denied',
  answer: 'granted' as 'granted' | 'denied' | 'prompt',
  token: 'fcm-token-1' as string | Promise<never>,
  asked: 0,
  deleted: 0,
  tap: null as null | ((event: unknown) => void),
  removed: 0,
}))
const worker = vi.hoisted(() => ({ calls: [] as Array<{ type: string; data: unknown }> }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => native.platform },
}))
vi.mock('@capacitor-firebase/messaging', () => ({
  FirebaseMessaging: {
    checkPermissions: async () => ({ receive: native.permission }),
    requestPermissions: async () => { native.asked += 1; native.permission = native.answer; return { receive: native.answer } },
    getToken: async () => ({ token: await native.token }),
    deleteToken: async () => { native.deleted += 1 },
    addListener: async (_name: string, fn: (event: unknown) => void) => { native.tap = fn; return { remove: async () => { native.removed += 1 } } },
  },
}))
vi.mock('firebase/messaging', () => ({ deleteToken: vi.fn(), getMessaging: vi.fn(), getToken: vi.fn(), isSupported: async () => false }))
vi.mock('../firebase', () => ({ app: {} }))
vi.mock('./install', () => ({ isStandalone: () => false }))
vi.mock('./worker', () => ({ callWorker: async (type: string, data: unknown) => { worker.calls.push({ type, data }); return { ok: true } } }))

import { disablePush, enablePush, onPushOpened, pushState, refreshPush } from './push'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
})

beforeEach(() => {
  store.clear()
  worker.calls = []
  Object.assign(native, { platform: 'android', permission: 'prompt', answer: 'granted', token: 'fcm-token-1', asked: 0, deleted: 0, tap: null, removed: 0 })
})

describe('push in the installed app', () => {
  it('is off until switched on, and asking happens only on the tap', async () => {
    expect(await pushState()).toBe('off')
    expect(native.asked).toBe(0)
    expect(await enablePush()).toBe('on')
    expect(native.asked).toBe(1)
    expect(worker.calls).toEqual([{ type: 'registerFcmToken', data: { token: 'fcm-token-1' } }])
    expect(await pushState()).toBe('on')
  })

  it('registers nothing when the person says no', async () => {
    native.answer = 'denied'
    expect(await enablePush()).toBe('blocked')
    expect(worker.calls).toEqual([])
    expect(await pushState()).toBe('blocked')
  })

  it('hands the worker a changed token on app start, without asking again', async () => {
    await enablePush()
    native.token = 'fcm-token-2'
    await refreshPush()
    expect(native.asked).toBe(1)
    expect(worker.calls.at(-1)).toEqual({ type: 'registerFcmToken', data: { token: 'fcm-token-2' } })
  })

  it('never asks or registers on app start when it was not switched on', async () => {
    await refreshPush()
    expect(native.asked).toBe(0)
    expect(worker.calls).toEqual([])
  })

  it('switching off forgets the token here and on the server', async () => {
    await enablePush()
    await disablePush()
    expect(worker.calls.at(-1)).toEqual({ type: 'registerFcmToken', data: { token: 'fcm-token-1', remove: true } })
    expect(native.deleted).toBe(1)
    expect(await pushState()).toBe('off')
  })

  it('says "not yet" on iPhone until the app is signed for push', async () => {
    native.platform = 'ios'
    expect(await pushState()).toBe('unsupported')
    expect(await enablePush()).toBe('unsupported')
    expect(native.asked).toBe(0)
  })

  it('reports what a tapped push points at', async () => {
    const opened: unknown[] = []
    const stop = onPushOpened((p) => opened.push(p))
    await Promise.resolve()
    native.tap?.({ actionId: 'tap', notification: { data: { type: 'photo.new', patientUid: 'p1', memoId: 'm1', extra: 7 } } })
    native.tap?.({ actionId: 'tap', notification: {} })
    expect(opened).toEqual([
      { type: 'photo.new', patientUid: 'p1', memoId: 'm1', digestId: undefined },
      { type: undefined, patientUid: undefined, memoId: undefined, digestId: undefined },
    ])
    stop()
    await Promise.resolve(); await Promise.resolve()
    expect(native.removed).toBe(1)
  })
})
