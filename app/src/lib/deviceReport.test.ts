// A parent's phone keeps its token current and reports its alert state.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  permission: 'granted',
  refresh: 'on',
  calls: [] as Record<string, unknown>[],
  stored: null as string | null,
}))

vi.mock('./permissions', () => ({ notificationPermission: vi.fn(async () => h.permission) }))
vi.mock('./push', () => ({ refreshElderPush: vi.fn(async () => h.refresh) }))
vi.mock('./worker', () => ({ callWorker: vi.fn(async (_t: string, data: Record<string, unknown>) => { h.calls.push(data) }) }))
vi.mock('./appVersion', async (original) => ({
  ...(await original<typeof import('./appVersion')>()),
  nativeAppInfo: vi.fn(async () => ({ version: '1.0.6', build: '1', platform: 'ios' })),
  lastReported: () => h.stored,
  rememberReported: (v: string, at: number, a?: string) => { h.stored = `${v}:${at}${a ? `:${a}` : ''}` },
}))

import { syncThisDevice } from './deviceReport'
import { refreshElderPush } from './push'

describe('syncThisDevice', () => {
  beforeEach(() => {
    h.permission = 'granted'; h.refresh = 'on'; h.calls = []; h.stored = null
    vi.mocked(refreshElderPush).mockClear()
  })

  it('allowed: refreshes the token and reports what came of it', async () => {
    await syncThisDevice('d1')
    expect(refreshElderPush).toHaveBeenCalledWith('d1')
    expect(h.calls[0]).toMatchObject({ deviceId: 'd1', alerts: 'on' })
    h.refresh = 'no-token'
    await syncThisDevice('d1')
    expect(h.calls[1]).toMatchObject({ alerts: 'no-token' })
  })

  it('refused or not asked: no token work, and the state goes up', async () => {
    h.permission = 'denied'
    await syncThisDevice('d1')
    expect(h.calls[0]).toMatchObject({ alerts: 'off' })
    h.permission = 'prompt'
    await syncThisDevice('d1')
    expect(h.calls[1]).toMatchObject({ alerts: 'not-asked' })
    expect(refreshElderPush).not.toHaveBeenCalled()
  })

  it('an unreadable permission claims nothing, and the same state within the hour stays quiet', async () => {
    h.permission = 'unknown'
    await syncThisDevice('d1')
    expect(h.calls[0]).not.toHaveProperty('alerts')
    h.calls = []; h.stored = null; h.permission = 'granted'
    await syncThisDevice('d1')
    await syncThisDevice('d1')
    expect(h.calls).toHaveLength(1)
  })
})
