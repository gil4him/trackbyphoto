import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
vi.mock('../lib/capture', () => ({ savePhoto: vi.fn(), captureNativePhoto: vi.fn(), isNativeApp: false }))
vi.mock('../lib/location', () => ({ warmUpLocation: vi.fn() }))
vi.mock('../hooks/useAppUpdate', () => ({ noteCaptureStarted: vi.fn() }))

import { CameraFab, FamilyCamera } from './CameraFab'
import { ToastProvider } from './Toast'

describe('CameraFab', () => {
  it('is one labelled camera button', () => {
    const html = renderToString(<CameraFab onClick={() => {}} />)
    expect(html).toContain('class="cam-fab"')
    expect(html).toContain('aria-label="사진 찍기"')
    expect(html).not.toContain('disabled')
  })

  it('can say where it goes and be disabled while a photo saves', () => {
    const html = renderToString(<CameraFab onClick={() => {}} disabled label="카메라로 돌아가기" />)
    expect(html).toContain('aria-label="카메라로 돌아가기"')
    expect(html).toContain('disabled')
  })

  it('the family camera renders inside the app\'s ToastProvider', () => {
    const html = renderToString(<ToastProvider><FamilyCamera uid="me" viewingOther={false} show /></ToastProvider>)
    expect(html).toContain('class="cam-fab"')
    expect(html).toContain('type="file"')
    expect(renderToString(<ToastProvider><FamilyCamera uid="me" viewingOther show={false} /></ToastProvider>)).not.toContain('cam-fab')
  })
})
