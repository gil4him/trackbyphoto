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
  it('offers the family link, the QR and code entry, with 가족이에요', () => {
    const html = render('live')
    expect(html).toContain('가족이 보낸 링크를 누르거나 QR을 비춰주세요')
    expect(html).toContain('가족이 보낸 링크를 한 번 더 눌러주세요')
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

  it('asks for the camera in one plain sentence, code entry still there', () => {
    const html = renderToString(<ElderPairStartView phase="starting" asking onFamily={() => {}} onEnterCode={() => {}} onRetry={() => {}} onAskNext={() => {}} />)
    expect(html).toContain('가족과 연결하려면 카메라를 허용해 주세요')
    expect(html).toContain('다음')
    expect(html).toContain('코드 입력')
  })
})
