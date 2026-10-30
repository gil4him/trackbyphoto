// What the parent's phone says when a pairing code fails, and which failures
// are final. A used, expired, replaced or declined code can never work again:
// trying it once more only repeats the answer (a Galaxy did that all day on
// 2026-10-29), so those take the parent to a new code instead of 다시 시도.
// The pairing screens say 자녀 for the one who connects the phone (CLAUDE.md).

import { PairingBlockedError } from './elderSession'
import { tr } from './lang'
import { WorkerError, WORKER_OFFLINE_MESSAGE } from './worker'

export function pairErrorMessage(err: unknown, opts: { spentHere?: boolean } = {}): string {
  if (err instanceof PairingBlockedError) {
    return tr('이 휴대폰은 자녀 계정으로 로그인되어 있어요. 부모님 휴대폰에서 열어 주세요.', "This phone is signed in to a family account. Please open this on your parent's phone.")
  }
  const code = err instanceof WorkerError ? err.code : ''
  switch (code) {
    case 'unavailable': return WORKER_OFFLINE_MESSAGE
    case 'not-found':
    case 'invalid-argument': return tr('코드가 맞지 않아요. 자녀가 보낸 코드를 다시 확인해 주세요.', "That code doesn't match. Please check the code your family sent.")
    case 'failed-precondition': return opts.spentHere
      ? tr('이 코드는 이미 이 휴대폰을 연결할 때 썼어요. 자녀에게 새 연결을 요청해 주세요.', 'This phone already used this code to connect. Please ask your family for a new link.')
      : tr('이미 사용된 코드예요. 자녀에게 새 연결을 요청해 주세요.', 'This code was already used. Please ask your family for a new link.')
    case 'deadline-exceeded': return tr('코드 사용 기간이 지났거나 새 코드로 바뀌었어요. 자녀가 보낸 가장 최근 링크나 QR을 써 주세요.', 'This code expired or was replaced by a newer one. Please use the latest link or QR code your family sent.')
    case 'resource-exhausted': return tr('시도가 너무 많았어요. 10분 뒤에 다시 해 주세요.', 'Too many tries. Please try again in 10 minutes.')
    case 'permission-denied': return tr('연결이 거절되었어요. 자녀에게 문의해 주세요.', 'The link was declined. Please ask your family.')
    default: return tr('연결하지 못했어요. 잠시 후 다시 시도해 주세요.', "Couldn't connect. Please try again in a moment.")
  }
}

const FINAL = new Set(['failed-precondition', 'deadline-exceeded', 'permission-denied'])

/** True when trying the same code again can only fail the same way. */
export function isTerminalPairError(err: unknown): boolean {
  if (err instanceof PairingBlockedError) return true
  return err instanceof WorkerError && FINAL.has(err.code)
}
