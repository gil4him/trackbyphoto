// Which Settings sections a guardian sees for their parent in the simple edition.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/edition', () => ({ isSimple: () => true, EDITION: 'simple' }))
vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/worker', () => ({ callWorker: vi.fn(), isWorkerOffline: () => false, WorkerError: class extends Error {}, WORKER_OFFLINE_MESSAGE: '' }))
vi.mock('../hooks/useMemberships', () => ({
  useMemberships: () => ({ caregivers: [{ caregiverUid: 'me', role: 'guardian', status: 'active', caregiverName: '지은' }], patients: [], loading: false }),
}))
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../components/ElderDevices', () => ({ ElderDevices: () => <div>기기 관리</div> }))
vi.mock('../lib/push', () => ({ enablePush: vi.fn(), pushState: vi.fn(async () => 'off') }))

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
    pushRollout
  />,
)

describe('Settings for a parent (simple)', () => {
  it('has only 계정 · 부모님 · 알림 · 도움말·약관 · 로그아웃 · 계정 삭제, in that order', () => {
    const order = ['>계정<', '>부모님<', '>알림<', '도움말·약관', '>로그아웃<', '>계정 삭제<']
    const at = order.map((s) => html.indexOf(s))
    for (const [i, s] of order.entries()) expect(at[i], s).toBeGreaterThan(-1)
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1])
    for (const s of ['표시되는 이름', '요금제', '음성 답장', '글자 크기', '자동 기록', '전송 시점', '사진 보관', '>언어<', 'Phase 1 안내', '부모님 삭제']) expect(html, s).not.toContain(s)
  })

  it("부모님: the parent's phone, 함께 보는 가족 with ⋯ (no red button inline), and 가족 초대하기", () => {
    expect(html).toContain('기기 관리')
    expect(html).toContain('함께 보는 가족')
    expect(html).toContain('가족 초대하기')
    expect(html).not.toContain('send-del')
    expect(html).not.toContain('danger-btn')
  })

  it('부모님: 메모 말투 for the family that manages the parent, 다정하게 on by default', () => {
    expect(html).toContain('aria-label="메모 말투"')
    expect(html).toContain('>담백하게<')
    expect(html).toContain('class="on">다정하게<')
    expect(html).toContain('>재치있게<')
    expect(html.indexOf('메모 말투')).toBeLessThan(html.indexOf('함께 보는 가족'))
  })

  it('부모님: 집 위치 as one address box, between 메모 말투 and 함께 보는 가족', () => {
    expect(html).toContain('>집 위치<')
    expect(html).toContain('aria-label="주소나 건물 이름"')
    expect(html).not.toContain('자동으로 추정해요')
    expect(html).not.toContain('주소로 찾기')
    expect(html).not.toContain('지금 있는 곳을 집으로 설정')
    expect(html.indexOf('메모 말투')).toBeLessThan(html.indexOf('집 위치'))
    expect(html.indexOf('집 위치')).toBeLessThan(html.indexOf('함께 보는 가족'))
  })

  it('알림: the 앱 알림 switch, then 알림 시간', () => {
    expect(html).toContain('aria-label="앱 알림 전환"')
    expect(html.indexOf('앱 알림')).toBeLessThan(html.indexOf('알림 시간'))
    expect(html).toContain('저녁 8시')
    expect(html).not.toContain('매일 이 시간에 오늘 사진 몇 장인지 알려드려요')
  })

  it('links the privacy policy and terms as rows; 계정 삭제 is a muted link', () => {
    expect(html).toContain('/privacy')
    expect(html).toContain('/terms')
    expect(html).toContain('class="quiet-link"')
  })
})

describe('Settings for oneself (simple)', () => {
  const mine = renderToString(
    <Settings
      settings={{ patientName: '지은', cadence: 'daily', autoMode: true, bigText: true, retention: '90' } as unknown as UserSettings}
      onChange={() => {}}
      user={{ uid: 'me', email: 'me@example.com', displayName: '지은' } as unknown as User}
      onSignOut={async () => {}}
      memos={[]}
      activePatientUid="me"
      isSelf
      onSwitchPatient={() => {}}
      people={[{ patientUid: 'mom', name: '엄마', membership: { patientUid: 'mom', role: 'guardian', status: 'active' } }, { patientUid: 'dad', name: '아빠', membership: { patientUid: 'dad', role: 'viewer', status: 'active' } }] as never}
      pushRollout
    />,
  )
  it('부모님 등록하기, then 함께 보는 가족 with a ⋯ per person and no 삭제 button', () => {
    expect(mine).toContain('부모님 등록하기')
    expect(mine).toContain('aria-label="엄마 더보기"')
    expect(mine).toContain('aria-label="아빠 더보기"')
    expect(mine).not.toContain('>삭제<')
    expect(mine).not.toContain('send-del')
    expect(mine).not.toContain('표시되는 이름')
  })
  it('has its own 집 위치 box, the same one as the parent\'s, between 부모님 and 알림', () => {
    expect(mine).toContain('>집 위치<')
    expect(mine).toContain('aria-label="주소나 건물 이름"')
    expect(mine.indexOf('부모님 등록하기')).toBeLessThan(mine.indexOf('집 위치'))
    expect(mine.indexOf('집 위치')).toBeLessThan(mine.indexOf('>알림<'))
  })
})
