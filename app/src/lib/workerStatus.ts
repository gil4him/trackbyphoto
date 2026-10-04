// Is the memo server (the Mac mini worker) able to write memos right now?
//
// The worker stamps system/worker once a minute. A stamp older than a few
// minutes, or one saying the model isn't answering, means a waiting memo will
// keep waiting, and the app should say so rather than "메모 작성 중…".

export type WorkerStatus = 'unknown' | 'ok' | 'down'

export interface WorkerBeat {
  lastSeenMs: number
  modelUp: boolean
}

/** Three missed beats, with room for a phone clock that runs a little fast. */
export const STALE_MS = 4 * 60_000

export function workerStatus(beat: WorkerBeat | null, nowMs: number): WorkerStatus {
  if (!beat) return 'unknown'
  if (!beat.modelUp || nowMs - beat.lastSeenMs > STALE_MS) return 'down'
  return 'ok'
}
