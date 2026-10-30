// The simple edition's parent screen, rendered without a browser or a
// camera: the big 사진 찍기 button, 내 사진, the family bubble, the sent
// overlay and the no-camera state.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/capture', () => ({ savePhoto: vi.fn() }))
vi.mock('../lib/location', () => ({ warmUpLocation: vi.fn(), askLocation: vi.fn() }))
vi.mock('../lib/reactions', () => ({ markRead: vi.fn() }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }))
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: vi.fn(async () => {}) }, ImpactStyle: { Medium: 'MEDIUM' } }))
vi.mock('../hooks/useMemberships', () => ({ useMemberships: () => ({ caregivers: [], patients: [], loading: false }) }))

import { ElderCameraView, type Overlay } from './ElderCamera'
import { ASK_NOTIFY } from '../lib/permissions'
import type { ElderNews } from '../lib/reactionsModel'
import type { Memo, Reaction } from '../types'

const comment = { id: 'r1', memoId: 'm1', actorUid: 'd', actorName: '지은', kind: 'comment', text: '엄마 꽃 예뻐요', createdAtMs: 1 } as unknown as Reaction
const heart = { ...comment, id: 'r2', kind: 'heart', text: undefined } as unknown as Reaction
const none = () => {}

const render = (p: { denied?: boolean; busy?: boolean; overlay?: Overlay | null; news?: ElderNews | null } = {}) => renderToString(
  <ElderCameraView
    denied={p.denied ?? false}
    busy={p.busy ?? false}
    overlay={p.overlay ?? null}
    news={p.news ?? null}
    onShutter={none}
    onDismissNews={none}
    onOpenRecords={none}
    onRetry={none}
  />,
).replace(/<!-- -->/g, '')

describe('ElderCameraView', () => {
  it('is one big 사진 찍기 button and 내 사진, nothing else', () => {
    const out = render()
    expect(out).toContain('aria-label="사진 찍기"')
    expect(out).toContain('class="elder-launch-shutter"')
    expect(out).toContain('내 사진')
    expect(out).not.toContain('disabled')
    expect(out).not.toContain('elder-cam-bubble')
    expect(out).not.toContain('elder-cam-overlay')
    // The phone's camera has its own switch: no 전환 here, no viewfinder.
    expect(out).not.toContain('카메라 전환')
    expect(out).not.toContain('elder-cam-feed')
  })

  it('holds the button while a photo is being sent', () => {
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

  it('says when the photo could not be saved', () => {
    const out = render({ overlay: { ok: false, text: '사진을 저장하지 못했어요', sub: '다시 한 번 찍어 주세요' } })
    expect(out).toContain('사진을 저장하지 못했어요')
    expect(out).toContain('다시 한 번 찍어 주세요')
  })

  it('asks to allow the camera, with a big retry, in place of the button', () => {
    const out = render({ denied: true })
    expect(out).toContain('카메라를 사용할 수 없어요')
    expect(out).toContain('설정에서 카메라를 허용해 주세요')
    expect(out).toContain('다시 시도')
    expect(out).not.toContain('elder-launch-shutter')
  })

  it('asks in one plain sentence before the phone does, with no button', () => {
    const html = renderToString(
      <ElderCameraView busy={false} overlay={null} news={null} ask="사진에 장소를 남기려면 위치를 허용해 주세요"
        onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} onAskNext={none} />,
    )
    expect(html).toContain('사진에 장소를 남기려면 위치를 허용해 주세요')
    expect(html).toContain('다음')
    expect(html).not.toContain('사진 찍기')
    expect(html).not.toContain('내 사진')
    expect(renderToString(<ElderCameraView busy={false} overlay={null} news={null} ask="카메라를 켤게요" askNext="카메라 켜기" onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />)).toContain('카메라 켜기')
  })

  it('shows a new photo from family first, before hearts and comments', () => {
    const html = renderToString(
      <ElderCameraView busy={false} overlay={null} news={null} photos={{ line: '지은이 사진을 보냈어요', lit: true }}
        onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />,
    )
    expect(html).toContain('지은이 사진을 보냈어요')
    expect(html).toContain('🖼️')
  })
})

describe('the bottom row', () => {
  const view = (recent: Memo | null) => renderToString(
    <ElderCameraView busy={false} overlay={null} news={null} recent={recent}
      onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />,
  ).replace(/<!-- -->/g, '')
  const memo = { id: 'm1', patientUid: 'mom', photoUrl: 'https://photos.example/m1.jpg', activity: 'walk' } as unknown as Memo

  it('shows the parent’s newest photo in the 내 사진 circle', () => {
    const out = view(memo)
    const circle = out.slice(out.indexOf('elder-launch-recent'), out.indexOf('내 사진'))
    expect(circle).toContain('src="https://photos.example/m1.jpg"')
    expect(circle).not.toContain('elder-launch-recent-glyph')
  })

  it('draws a photos glyph before the first photo', () => {
    const out = view(null)
    expect(out).toContain('elder-launch-recent-glyph')
    expect(out).not.toContain('<img')
  })

  it('puts the corner button next to 내 사진 only when there is one', () => {
    expect(view(null)).not.toContain('elder-launch-side')
    const html = renderToString(
      <ElderCameraView busy={false} overlay={null} news={null} corner={<button type="button">아이콘 만들기</button>}
        onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />,
    )
    expect(html).toContain('elder-launch-side')
    expect(html).toContain('아이콘 만들기')
  })
})

describe('the family-photo bubble, looked at already', () => {
  const dim = { line: '가족 사진 다시 보기', lit: false }
  const view = (news: ElderNews | null, photos: { line: string; lit: boolean }) => renderToString(
    <ElderCameraView busy={false} overlay={null} news={news} photos={photos}
      onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />,
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

describe('the third plain sentence, for family news on the icon', () => {
  it('asks for notifications in one sentence with 다음, no button', () => {
    const html = renderToString(
      <ElderCameraView busy={false} overlay={null} news={null} ask={ASK_NOTIFY}
        onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} onAskNext={none} />,
    )
    expect(html).toContain('가족이 보낸 사진과 소식을 알려드리려면 알림을 허용해 주세요')
    expect(html).toContain('다음')
    expect(html).not.toContain('사진 찍기')
  })
})
