// 계정 삭제 — every signed-in family member can erase their own account from
// 설정, whether or not they look after a parent (App Store 5.1.1(v)).
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/edition', () => ({ isSimple: () => true, EDITION: 'simple' }))
vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/worker', () => ({ callWorker: vi.fn(), isWorkerOffline: () => false, WorkerError: class extends Error {}, WORKER_OFFLINE_MESSAGE: '' }))
vi.mock('../hooks/useMemberships', () => ({ useMemberships: () => ({ caregivers: [], patients: [], loading: false }) }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../components/ElderDevices', () => ({ ElderDevices: () => <div>기기 관리</div> }))

import { Settings } from './Settings'
import type { UserSettings } from '../types'
import type { User } from 'firebase/auth'

const render = (user: Partial<User>) => renderToString(
  <Settings
    settings={{ patientName: '지은', cadence: 'daily', autoMode: true, bigText: true, retention: '90' } as unknown as UserSettings}
    onChange={() => {}}
    user={user as User}
    onSignOut={async () => {}}
    memos={[]}
    activePatientUid="me"
    isSelf
    onSwitchPatient={() => {}}
  />,
)

describe('계정 삭제 in Settings', () => {
  it('is offered on my own account, with what it erases', () => {
    const html = render({ uid: 'me', email: 'me@example.com', displayName: '지은' })
    expect(html).toContain('계정 삭제')
    expect(html).toContain('내 사진과 기록, 가족 연결이 모두 지워지고 되돌릴 수 없어요')
    // Nothing is deleted until the confirmation sheet says so.
    expect(html).not.toContain('부모님 기록은 지워지지 않아요')
  })

  it('is not offered to a session without a sign-in account of its own', () => {
    expect(render({ uid: 'anon', email: null })).not.toContain('계정 삭제')
  })
})
