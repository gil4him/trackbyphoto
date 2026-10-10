// The simple edition's first screen on an unlinked phone, rendered without a
// browser or a camera: the scan hint, the two way-outs, the no-camera state.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/worker', () => ({ callWorker: vi.fn() }))
vi.mock('../lib/cameraPreview', () => ({ startPreview: vi.fn(), stopPreview: vi.fn(), captureSampleBlob: vi.fn() }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }))
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { read: vi.fn(async () => ({ value: '' })) } }))

import { ElderPairStartView } from './ElderPairStart'
import type { CameraPhase } from './ElderCamera'

const render = (phase: CameraPhase) => renderToString(
  <ElderPairStartView phase={phase} onFamily={() => {}} onEnterCode={() => {}} onRetry={() => {}} />,
)

describe('ElderPairStartView', () => {
  it('asks to point the camera at the family QR, with code entry and 가족이에요', () => {
    const html = render('live')
    expect(html).toContain('가족 휴대폰의 QR을 비춰주세요')
    expect(html).toContain('elder-pair-frame')
    expect(html).toContain('코드 입력')
    expect(html).toContain('가족이에요')
    expect(html).not.toContain('카메라를 사용할 수 없어요')
  })

  it('says how to fix a denied camera, and keeps the way-outs', () => {
    const html = render('denied')
    expect(html).toContain('카메라를 사용할 수 없어요')
    expect(html).toContain('다시 시도')
    expect(html).not.toContain('elder-pair-frame')
    expect(html).toContain('코드 입력')
    expect(html).toContain('가족이에요')
  })
})
