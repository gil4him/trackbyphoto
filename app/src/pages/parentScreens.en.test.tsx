// The parent's screens with the app in English: nothing Korean is left on them.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/lang', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/lang')>()),
  lang: 'en',
  tr: (_ko: string, en: string) => en,
  legalPath: (name: string) => `/en/${name}`,
}))
vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/cameraPreview', () => ({ startPreview: vi.fn(), stopPreview: vi.fn(), capturePhoto: vi.fn(), flipCamera: vi.fn(), resetFacing: vi.fn() }))
vi.mock('../lib/capture', () => ({ savePhoto: vi.fn() }))
vi.mock('../lib/location', () => ({ warmUpLocation: vi.fn(), askLocation: vi.fn() }))
vi.mock('../lib/reactions', () => ({ markRead: vi.fn(), COMMENT_MAX: 60 }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }))
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: vi.fn(async () => {}) }, ImpactStyle: { Medium: 'MEDIUM' } }))
vi.mock('../hooks/useMemberships', () => ({ useMemberships: () => ({ caregivers: [], patients: [], loading: false }) }))

import { ElderCameraView } from './ElderCamera'
import { ElderPairStartView } from './ElderPairStart'
import { PairLandingView } from './PairLanding'
import { SimpleConsent } from '../components/SimpleConsent'
import { TextReply } from '../components/TextReply'
import { S, QUICK_REPLIES } from '../lib/strings'
import { fmtDate, fmtTime, relativeDateLabel } from '../util'
import { dayCaption, dayEyebrow } from '../lib/memoViews'
import { ASK_CAMERA } from '../lib/permissions'
import type { Reaction } from '../types'

const HANGUL = /[가-힣]/
const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, '')
const comment = { id: 'r1', memoId: 'm1', actorUid: 'd', actorName: 'Jamie', kind: 'comment', text: 'Lovely flowers', createdAtMs: 1 } as unknown as Reaction
const none = () => {}

describe('the parent screens in English', () => {
  it('the camera: live, with a family message, sent, failed, and without a camera', () => {
    for (const out of [
      html(<ElderCameraView phase="live" busy={false} overlay={null} news={null} onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />),
      html(<ElderCameraView phase="live" busy={false} overlay={null} news={{ state: 'new', item: comment, unreadIds: ['r1'] }} onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />),
      html(<ElderCameraView phase="live" busy={false} overlay={{ ok: true, text: 'Sent to Jamie ♥' }} news={null} onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />),
      html(<ElderCameraView phase="denied" busy={false} overlay={null} news={null} onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />),
      html(<ElderCameraView phase="live" busy={false} overlay={null} news={null} ask={ASK_CAMERA} askNext="Turn on camera" onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />),
    ]) expect(out).not.toMatch(HANGUL)
    expect(html(<ElderCameraView phase="live" busy={false} overlay={null} news={null} onShutter={none} onDismissNews={none} onOpenRecords={none} onRetry={none} />))
      .toContain('aria-label="Take a photo"')
  })

  it('linking the phone and saying yes to the family', () => {
    for (const out of [
      html(<ElderPairStartView phase="live" onFamily={none} onEnterCode={none} onRetry={none} />),
      html(<ElderPairStartView phase="denied" onFamily={none} onEnterCode={none} onRetry={none} />),
      html(<PairLandingView code="ABC123" kind="ios" storeUrl="https://apps.apple.com/app/id1" onInstall={none} onWebPair={none} />),
      html(<PairLandingView code="ABC123" kind="other" storeUrl={null} onInstall={none} onWebPair={none} />),
      html(<SimpleConsent caregivers={[{ status: 'active', caregiverName: 'Jamie' }]} initialOpen onAccept={none} />),
      html(<SimpleConsent caregivers={[]} onAccept={none} />),
    ]) expect(out).not.toMatch(HANGUL)
    expect(html(<SimpleConsent caregivers={[]} onAccept={none} />)).toContain('Yes, show them')
  })

  it('replying', () => {
    expect(html(<TextReply to="Jamie" textMode="quick" onBack={none} onSend={none} />)).not.toMatch(HANGUL)
    expect(html(<TextReply to="Jamie" textMode="full" onBack={none} onSend={none} />)).not.toMatch(HANGUL)
    expect(QUICK_REPLIES.join(' ')).not.toMatch(HANGUL)
    expect(S.elderReplySent('Jamie')).toBe("Sent ✓ We'll pass it to Jamie")
  })

  it('dates, times and the day line', () => {
    const d = new Date(2026, 9, 18, 15, 5)
    expect(fmtDate(d)).toBe('Sun, Oct 18')
    expect(fmtTime(d)).toBe('3:05 PM')
    expect(dayEyebrow(d)).toBe('Sunday, October 18')
    expect(relativeDateLabel(new Date())).toBe('Today')
    expect(dayCaption(1, null)).toBe('1 photo')
    expect(dayCaption(9, 3.2)).toBe('9 photos · up to 2.0 mi from home')
  })
})
