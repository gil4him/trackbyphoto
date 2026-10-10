// Which Settings sections a guardian sees for their parent in the full edition.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/edition', () => ({ isSimple: () => false, EDITION: 'full' }))
vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/worker', () => ({ callWorker: vi.fn(), isWorkerOffline: () => false, WorkerError: class extends Error {}, WORKER_OFFLINE_MESSAGE: '' }))
vi.mock('../hooks/useMemberships', () => ({
  useMemberships: () => ({ caregivers: [{ caregiverUid: 'me', role: 'guardian', status: 'active', caregiverName: '지은' }], patients: [], loading: false }),
}))
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../components/ElderDevices', () => ({ ElderDevices: () => <div>기기 관리</div> }))

import { Settings } from './Settings'
import type { UserSettings } from '../types'
import type { User } from 'firebase/auth'

const html = renderToString(
  <Settings
    settings={{ patientName: '엄마', accountType: 'managed', cadence: 'daily', autoMode: true, bigText: true, retention: '90' } as unknown as UserSettings}
    onChange={() => {}}
    user={{ uid: 'me', email: 'me@example.com', displayName: '지은' } as unknown as User}
    onSignOut={async () => {}}
    memos={[]}
    activePatientUid="mom"
    isSelf={false}
    onSwitchPatient={() => {}}
    myRole="guardian"
    reactionsRollout
  />,
)

describe('Settings for a parent (full)', () => {
  it('keeps the core sections', () => {
    for (const s of ['계정', '기기 관리', '사용자 이름', '글자 크기', '부모님 삭제']) expect(html).toContain(s)
  })

  it('', () => {
    for (const s of ['가족 관리', '언어', '자동 기록', '전송 시점', '사진 보관', 'Phase 1 안내']) expect(html).toContain(s)
    expect(html).not.toContain('알림 시간')
  })
})
