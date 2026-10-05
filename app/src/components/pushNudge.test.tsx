// The family's "알림 켜기" card, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/push', () => ({ enablePush: vi.fn(), pushState: vi.fn(async () => 'off') }))
vi.mock('../lib/worker', () => ({ callWorker: vi.fn() }))

import { PushNudge } from './PushNudge'
import { ToastProvider } from './Toast'

const render = (state: Parameters<typeof PushNudge>[0]['state']) => renderToString(<ToastProvider><PushNudge state={state} /></ToastProvider>)

describe('PushNudge', () => {
  it('offers to switch notifications on where the device can get them and has not been asked', () => {
    const out = render('off')
    expect(out).toContain('새 사진이 오면 알려드릴까요?')
    expect(out).toContain('알림 켜기')
    expect(out).toContain('aria-label="나중에"')
  })

  it('stays out of the way everywhere else', () => {
    for (const state of ['on', 'blocked', 'unsupported', 'needs-install'] as const) {
      expect(render(state)).not.toContain('알림 켜기')
    }
  })
})
