import { isWorkerOffline, WORKER_OFFLINE_MESSAGE } from './worker'
import { S } from './strings'
import { tr } from './lang'

/** The second line under "바꾸지 못했어요": the worker's reason, in plain words. */
export function planFailureLine(err: unknown): string {
  if (isWorkerOffline(err)) return WORKER_OFFLINE_MESSAGE
  const msg = (err as { message?: string })?.message ?? ''
  if (msg.includes('subscription used for another parent')) return S.planUsedForAnother
  if (msg.includes('parent paid by another')) return S.planPaidByAnother
  if (msg.includes('cancel in store')) return S.planCancelInStore
  if (msg.includes('not entitled')) return S.planNotEntitled
  return tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment')
}
