import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('./worker', async (importActual) => ({ ...(await importActual<typeof import('./worker')>()), callWorker: vi.fn() }))

import { isTerminalPairError, pairErrorMessage } from './pairErrors'
import { PairingBlockedError } from './elderSession'
import { WorkerError, WORKER_OFFLINE_MESSAGE } from './worker'

const w = (code: string) => new WorkerError(code, code)

describe('pairErrorMessage', () => {
  it('a used code: asks for a new link; one this phone itself used says so', () => {
    expect(pairErrorMessage(w('failed-precondition'))).toBe('이미 사용된 코드예요. 자녀에게 새 연결을 요청해 주세요.')
    expect(pairErrorMessage(w('failed-precondition'), { spentHere: true })).toBe('이 코드는 이미 이 휴대폰을 연결할 때 썼어요. 자녀에게 새 연결을 요청해 주세요.')
  })

  it('an expired or replaced code points to the latest link', () => {
    expect(pairErrorMessage(w('deadline-exceeded'))).toBe('코드 사용 기간이 지났거나 새 코드로 바뀌었어요. 자녀가 보낸 가장 최근 링크나 QR을 써 주세요.')
  })

  it('the other answers are unchanged', () => {
    expect(pairErrorMessage(w('unavailable'))).toBe(WORKER_OFFLINE_MESSAGE)
    expect(pairErrorMessage(w('not-found'))).toContain('코드가 맞지 않아요')
    expect(pairErrorMessage(w('invalid-argument'))).toContain('코드가 맞지 않아요')
    expect(pairErrorMessage(w('resource-exhausted'))).toContain('10분 뒤에')
    expect(pairErrorMessage(w('permission-denied'))).toContain('거절되었어요')
    expect(pairErrorMessage(new Error('boom'))).toContain('잠시 후 다시 시도해 주세요')
  })

  it("a family member's phone is told whose phone this is for", () => {
    expect(pairErrorMessage(new PairingBlockedError('family'))).toBe('이 휴대폰은 자녀 계정으로 로그인되어 있어요. 부모님 휴대폰에서 열어 주세요.')
  })
})

describe('isTerminalPairError', () => {
  it('used, expired/replaced, declined and a blocked sign-in are final', () => {
    for (const code of ['failed-precondition', 'deadline-exceeded', 'permission-denied']) expect(isTerminalPairError(w(code))).toBe(true)
    expect(isTerminalPairError(new PairingBlockedError('linked'))).toBe(true)
  })

  it('a mistyped code, a busy worker or no connection are worth another try', () => {
    for (const code of ['not-found', 'invalid-argument', 'unavailable', 'resource-exhausted', 'internal']) expect(isTerminalPairError(w(code))).toBe(false)
    expect(isTerminalPairError(new Error('boom'))).toBe(false)
  })
})
