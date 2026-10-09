// Which first screen a linked parent's phone shows in the simple edition.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/edition', () => ({ isSimple: () => true, EDITION: 'simple' }))
vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/cameraPreview', () => ({ startPreview: vi.fn(), stopPreview: vi.fn(), capturePhoto: vi.fn() }))
vi.mock('../lib/capture', () => ({ savePhoto: vi.fn(), captureNativePhoto: vi.fn(), isNativeApp: false }))
vi.mock('../lib/location', () => ({ warmUpLocation: vi.fn() }))
vi.mock('../lib/reactions', () => ({ markRead: vi.fn() }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }))
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: vi.fn(async () => {}) }, ImpactStyle: { Medium: 'MEDIUM' } }))
vi.mock('../hooks/useMemberships', () => ({ useMemberships: () => ({ caregivers: [], patients: [], loading: false }) }))
vi.mock('../hooks/useFamilyPhotos', () => ({ useFamilyPhotos: () => [] }))
vi.mock('../hooks/useOutbox', () => ({ useOutbox: () => [] }))
vi.mock('../hooks/useAppUpdate', () => ({ noteCaptureStarted: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ resetIfAccountGone: vi.fn() }))
vi.mock('../components/MemoThumb', () => ({ MemoThumb: () => <span className="tl-thumb" /> }))
vi.mock('../components/ElderInstallButton', () => ({ ElderInstallButton: () => null }))

import { ElderApp } from './ElderApp'
import { ToastProvider } from '../components/Toast'

const render = () => renderToString(
  <ToastProvider>
    <ElderApp uid="mom" deviceId="d1" patientName="어머니" memos={[]} reactions={[]} voiceOn={false} onRelink={() => {}} />
  </ToastProvider>,
).replace(/<!-- -->/g, '')

describe('ElderApp (simple)', () => {
  it('opens on the camera, not the home screen', () => {
    const out = render()
    expect(out).toContain('elder-cam-shutter')
    expect(out).toContain('내 사진')
    expect(out).not.toContain('오늘 가족 소식이 아직 없어요')
  })
})
