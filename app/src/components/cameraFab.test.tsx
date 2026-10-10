import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { CameraFab } from './CameraFab'

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
})
