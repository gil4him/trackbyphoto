// The number on the app icon: through the phone in the store apps, through
// the browser's badge in a home-screen web app, nothing in a plain tab.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const badge = vi.hoisted(() => ({ set: vi.fn(async () => {}), clear: vi.fn(async () => {}) }))
vi.mock('@capawesome/capacitor-badge', () => ({ Badge: badge }))
const messaging = vi.hoisted(() => ({ removeAllDeliveredNotifications: vi.fn(async () => {}) }))
vi.mock('@capacitor-firebase/messaging', () => ({ FirebaseMessaging: messaging }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))

import { setAppBadge } from './appBadge'

const page = { visibilityState: 'visible' as DocumentVisibilityState }
beforeEach(() => {
  badge.set.mockClear(); badge.clear.mockClear(); messaging.removeAllDeliveredNotifications.mockClear()
  page.visibilityState = 'visible'
  vi.stubGlobal('document', page)
  // The test runs in Node: a bare navigator to hang the browser badge on.
  vi.stubGlobal('navigator', {})
})

describe('setAppBadge', () => {
  it('sets the phone\'s icon number in the store app, and clears it at zero', () => {
    setAppBadge(3, true)
    expect(badge.set).toHaveBeenCalledWith({ count: 3 })
    setAppBadge(0, true)
    expect(badge.clear).toHaveBeenCalled()
  })

  it('clears the app\'s notifications from the tray while it is on screen, so Samsung\'s count follows', () => {
    setAppBadge(0, true)
    expect(messaging.removeAllDeliveredNotifications).toHaveBeenCalledOnce()
    // In the background a notice that just arrived must stay in the tray.
    page.visibilityState = 'hidden'
    setAppBadge(1, true)
    expect(messaging.removeAllDeliveredNotifications).toHaveBeenCalledOnce()
    expect(badge.set).toHaveBeenCalledWith({ count: 1 })
  })

  it('uses the browser badge on the web, and survives a browser without one', () => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    const set = vi.fn(async () => {}); const clear = vi.fn(async () => {})
    nav.setAppBadge = set; nav.clearAppBadge = clear
    setAppBadge(2, false)
    expect(set).toHaveBeenCalledWith(2)
    setAppBadge(0, false)
    expect(clear).toHaveBeenCalled()
    expect(badge.set).not.toHaveBeenCalled()
    Object.assign(nav, { setAppBadge: undefined, clearAppBadge: undefined })
    expect(() => setAppBadge(1, false)).not.toThrow()
  })
})
