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
import { appStateAction } from '../lib/cameraState'
import type { ElderNews } from '../lib/reactionsModel'
import type { Memo, Reaction } from '../types'

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
    const ok = render({ overlay: { ok: true, text: '지은에게 보냈어요 ♥' } })
    expect(ok).toContain('지은에게 보냈어요')
    expect(ok).toContain('<span class="elder-cam-heart" aria-hidden="true">♥</span>')
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
    expect(renderToString(<ElderCameraView phase="starting" busy={false} overlay={null} news={null} ask="카메라를 켤게요" askNext="카메라 켜기" onShutter={() => {}} onDismissNews={() => {}} onOpenRecords={() => {}} onRetry={() => {}} />)).toContain('카메라 켜기')
    expect(html).not.toContain('사진 찍기')
  })

  it('shows a new photo from family first, before hearts and comments', () => {
    const html = renderToString(
      <ElderCameraView phase="live" busy={false} overlay={null} news={null} photos={{ line: '지은이 사진을 보냈어요', lit: true }}
        onShutter={() => {}} onDismissNews={() => {}} onOpenRecords={() => {}} onRetry={() => {}} />,
    )
    expect(html).toContain('지은이 사진을 보냈어요')
    expect(html).toContain('🖼️')
  })

  it('has a camera switch next to the shutter', () => {
    const html = render({ phase: 'live' })
    expect(html).toContain('aria-label="카메라 전환"')
  })
})

describe('the bottom bar, laid out like the iPhone camera (A11)', () => {
  const view = (recent: Memo | null) => renderToString(
    <ElderCameraView phase="live" busy={false} overlay={null} news={null} recent={recent}
      onShutter={() => {}} onDismissNews={() => {}} onOpenRecords={() => {}} onRetry={() => {}} />,
  ).replace(/<!-- -->/g, '')
  const memo = { id: 'm1', patientUid: 'mom', photoUrl: 'https://photos.example/m1.jpg', activity: 'walk' } as unknown as Memo

  it('names the three controls under their circles: 내 사진 · 사진 찍기 · 전환', () => {
    const out = view(null)
    const bar = out.slice(out.indexOf('class="elder-cam-bar"'))
    expect(bar.match(/class="elder-cam-label"/g)).toHaveLength(3)
    for (const label of ['내 사진', '사진 찍기', '전환']) expect(bar).toContain(`<span class="elder-cam-label">${label}</span>`)
    expect(bar.match(/elder-cam-circle /g)).toHaveLength(3)
  })

  it('shows the parent’s newest photo in the 내 사진 circle', () => {
    const out = view(memo)
    const circle = out.slice(out.indexOf('elder-cam-recent'), out.indexOf('내 사진'))
    expect(circle).toContain('src="https://photos.example/m1.jpg"')
    expect(circle).not.toContain('elder-cam-recent-glyph')
  })

  it('draws a photos glyph before the first photo', () => {
    const out = view(null)
    expect(out).toContain('elder-cam-recent-glyph')
    expect(out).not.toContain('<img')
  })

  it('keeps the bar away while the plain sentence asks', () => {
    const html = renderToString(
      <ElderCameraView phase="starting" busy={false} overlay={null} news={null} ask="카메라를 켤게요" askNext="카메라 켜기"
        onShutter={() => {}} onDismissNews={() => {}} onOpenRecords={() => {}} onRetry={() => {}} />,
    )
    expect(html).not.toContain('elder-cam-bar')
    expect(html).toContain('class="elder-cam"')
    expect(view(null)).toContain('class="elder-cam with-bar"')
  })
})

describe('the family-photo bubble, looked at already', () => {
  const dim = { line: '가족 사진 다시 보기', lit: false }
  const view = (news: ElderNews | null, photos: { line: string; lit: boolean }) => renderToString(
    <ElderCameraView phase="live" busy={false} overlay={null} news={news} photos={photos}
      onShutter={() => {}} onDismissNews={() => {}} onOpenRecords={() => {}} onRetry={() => {}} />,
  ).replace(/<!-- -->/g, '')

  it('stays, quiet, and still opens the album', () => {
    const out = view(null, dim)
    expect(out).toContain('class="elder-cam-bubble dim"')
    expect(out).toContain('가족 사진 다시 보기')
    expect(out).not.toContain('class="elder-cam-bubble"')
  })

  it('gives way to a new heart or word, so the quiet bubble never hides them', () => {
    const out = view({ state: 'new', item: comment, unreadIds: ['r1'] }, dim)
    expect(out).toContain('엄마 꽃 예뻐요')
    expect(out).not.toContain('가족 사진 다시 보기')
    expect(out.match(/elder-cam-bubble"/g)).toHaveLength(1)
  })

  it('but a new photo still comes before a new heart', () => {
    const out = view({ state: 'new', item: heart, unreadIds: ['r2'] }, { line: '지은이 사진을 보냈어요', lit: true })
    expect(out).toContain('지은이 사진을 보냈어요')
    expect(out).not.toContain('하트')
  })
})

describe('the camera while the phone asks its own permission question', () => {
  it('ignores the app going inactive and active again, so tapping 허용 keeps the camera', () => {
    expect(appStateAction(false, true, false)).toBe('ignore')
    expect(appStateAction(true, true, false)).toBe('ignore')
  })
  it('otherwise stops in the background and restarts on coming back', () => {
    expect(appStateAction(false, false, false)).toBe('stop')
    expect(appStateAction(true, false, false)).toBe('restart')
  })
  it('does not restart on top of the camera’s plain sentence', () => {
    expect(appStateAction(true, false, true)).toBe('ignore')
  })
})
