// The pairing screen on a phone that is already signed in, or holding a code
// it is done with.
//
// Yera's Galaxy, 2026-10-29: a linked phone whose token claims could not be
// read at launch was shown "자녀 계정 ()으로 로그인되어 있어요" with a button
// that signed the parent out, then retried its own spent code all day.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

const { authState } = vi.hoisted(() => ({
  authState: { currentUser: null as null | { uid: string; isAnonymous: boolean; email?: string | null; providerData: { providerId: string }[] } },
}))

vi.mock('../firebase', () => ({ auth: authState, db: {}, storage: {} }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }))
vi.mock('firebase/firestore', () => ({ addDoc: vi.fn(), collection: vi.fn(), doc: vi.fn(), onSnapshot: vi.fn(), serverTimestamp: vi.fn() }))
vi.mock('../lib/edition', () => ({ isSimple: () => true, EDITION: 'simple' }))
vi.mock('../lib/worker', async (importActual) => ({ ...(await importActual<typeof import('../lib/worker')>()), callWorker: vi.fn() }))
vi.mock('../lib/elderSession', async (importActual) => ({
  ...(await importActual<typeof import('../lib/elderSession')>()),
  signInAsElder: vi.fn(),
  signInForPairing: vi.fn(),
}))
vi.mock('../hooks/useMemberships', () => ({ useMemberships: () => ({ caregivers: [], patients: [], loading: false }) }))
vi.mock('../components/SimpleConsent', () => ({ SimpleConsent: () => null }))
vi.mock('../lib/install', async (importActual) => ({
  ...(await importActual<typeof import('../lib/install')>()),
  currentInstallPath: () => 'none',
}))

import { PairDevice } from './PairDevice'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v) },
  removeItem: (k: string) => { storage.delete(k) },
})

const render = (props: { onRescan?: () => void } = {}) => renderToString(
  <PairDevice initialCode="ABCD2345" alreadyLinked={false} onDone={() => {}} onCancel={() => {}} {...props} />,
)

const parent = { uid: 'mom', isAnonymous: false, email: null, providerData: [] }
const family = { uid: 'kid', isAnonymous: false, email: 'kid@example.com', providerData: [{ providerId: 'google.com' }] }

beforeEach(() => storage.clear())

describe('PairDevice on a signed-in phone', () => {
  it("a connected parent's phone leaves pairing, even when its token could not be refreshed", () => {
    authState.currentUser = parent
    const html = render()
    expect(html).toBe('')
  })

  it("a family member's account: the warning names the account", () => {
    authState.currentUser = family
    const html = render()
    expect(html).toContain('부모님 휴대폰에서')
    expect(html).toContain('(kid@example.com)')
  })

  it('a family account without an e-mail: no empty brackets', () => {
    authState.currentUser = { ...family, email: null, providerData: [{ providerId: 'password' }] }
    const html = render()
    expect(html.replace(/<!-- -->/g, '')).toContain('자녀 계정으로 로그인되어 있어요')
    expect(html).not.toContain('()')
    expect(html).not.toContain('undefined')
  })
})

describe('PairDevice with a code this phone is done with', () => {
  beforeEach(() => { storage.set('tbp.pair.spent', JSON.stringify(['ABCD2345'])) })

  it("in the parent's app: says so and offers the QR camera, never 다시 시도", () => {
    authState.currentUser = null
    const html = render({ onRescan: () => {} })
    expect(html).toContain('이 코드는 이미 이 휴대폰을 연결할 때 썼어요')
    expect(html).toContain('QR 다시 비추기')
    expect(html).toContain('코드 직접 입력')
    expect(html).not.toContain('다시 시도')
    expect(html).not.toContain('>연결하기</button>')
  })

  it('in a browser: typing a new code comes first, 나중에 second', () => {
    authState.currentUser = null
    const html = render()
    expect(html).toContain('이 코드는 이미 이 휴대폰을 연결할 때 썼어요')
    expect(html).toContain('>코드 직접 입력</button>')
    expect(html).toContain('나중에')
    expect(html).not.toContain('QR 다시 비추기')
    expect(html).not.toContain('다시 시도')
  })

  it('a fresh code on a signed-out phone still asks 연결할까요?', () => {
    storage.clear()
    authState.currentUser = null
    const html = render({ onRescan: () => {} })
    expect(html).toContain('연결할까요?')
    expect(html).toContain('>연결하기</button>')
    expect(html).not.toContain('연결하지 못했어요')
  })
})
