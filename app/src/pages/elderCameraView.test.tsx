// The simple edition's parent camera screen, rendered without a browser or a
// camera: the shutter, 내 사진, the family bubble, the sent overlay and the
// no-camera state.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/cameraPreview', () => ({ startPreview: vi.fn(), stopPreview: vi.fn(), capturePhoto: vi.fn() }))
vi.mock('../lib/capture', () => ({ savePhoto: vi.fn() }))
vi.mock('../lib/location', () => ({ warmUpLocation: vi.fn() }))
vi.mock('../lib/reactions', () => ({ markRead: vi.fn() }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }))
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: vi.fn(async () => {}) }, ImpactStyle: { Medium: 'MEDIUM' } }))
vi.mock('../hooks/useMemberships', () => ({ useMemberships: () => ({ caregivers: [], patients: [], loading: false }) }))

import { ElderCameraView, type CameraPhase, type Overlay } from './ElderCamera'
import type { ElderNews } from '../lib/reactionsModel'
import type { Reaction } from '../types'

const comment = { id: 'r1', memoId: 'm1', actorUid: 'd', actorName: '지은', kind: 'comment', text: '엄마 꽃 예뻐요', createdAtMs: 1 } as unknown as Reaction
const heart = { ...comment, id: 'r2', kind: 'heart', text: undefined } as unknown as Reaction

const render = (p: { phase?: CameraPhase; busy?: boolean; overlay?: Overlay | null; news?: ElderNews | null } = {}) => renderToString(
  <ElderCameraView
    phase={p.phase ?? 'live'}
    busy={p.busy ?? false}
    overlay={p.overlay ?? null}
    news={p.news ?? null}
    onShutter={() => {}}
    onDismissNews={() => {}}
    onOpenRecords={() => {}}
    onRetry={() => {}}
  />,
).replace(/<!-- -->/g, '')

describe('ElderCameraView', () => {
  it('is a shutter and 내 사진, nothing else', () => {
    const out = render()
    expect(out).toContain('aria-label="사진 찍기"')
    expect(out).toContain('내 사진')
    expect(out).not.toContain('disabled')
    expect(out).not.toContain('elder-cam-bubble')
    expect(out).not.toContain('elder-cam-overlay')
  })

  it('holds the shutter while the camera starts or a photo is being sent', () => {
    expect(render({ phase: 'starting' })).toContain('disabled')
    expect(render({ busy: true })).toContain('disabled')
  })

  it('floats an unread comment with its words, and a heart on one line', () => {
    const c = render({ news: { state: 'new', item: comment, unreadIds: ['r1'] } })
    expect(c).toContain('지은이 글을 남겼어요')
    expect(c).toContain('엄마 꽃 예뻐요')
    const h = render({ news: { state: 'new', item: heart, unreadIds: ['r2'] } })
    expect(h).toContain('지은이 하트를 보냈어요')
  })

  it('shows nothing for news already seen', () => {
    expect(render({ news: { state: 'seen', item: comment, unreadIds: [] } })).not.toContain('elder-cam-bubble')
  })

  it('says who the photo went to', () => {
    expect(render({ overlay: { ok: true, text: '지은에게 보냈어요 ♥' } })).toContain('지은에게 보냈어요 ♥')
  })

  it('asks to allow the camera, with a big retry', () => {
    const out = render({ phase: 'denied' })
    expect(out).toContain('카메라를 사용할 수 없어요')
    expect(out).toContain('다시 시도')
  })

  it('asks in one plain sentence before the phone does, with no shutter', () => {
    const html = renderToString(
      <ElderCameraView phase="live" busy={false} overlay={null} news={null} ask="사진에 장소를 남기려면 위치를 허용해 주세요"
        onShutter={() => {}} onDismissNews={() => {}} onOpenRecords={() => {}} onRetry={() => {}} onAskNext={() => {}} />,
    )
    expect(html).toContain('사진에 장소를 남기려면 위치를 허용해 주세요')
    expect(html).toContain('다음')
    expect(html).not.toContain('사진 찍기')
  })
})
