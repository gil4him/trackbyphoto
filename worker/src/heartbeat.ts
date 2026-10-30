/**
 * Worker heartbeat.
 *
 * Once a minute the worker stamps system/worker with the time, whether the
 * model answers, and how many memos are waiting. The app reads it so that a
 * photo whose memo can't be written yet says so ("서버가 쉬는 중이에요")
 * instead of showing "메모 작성 중…" for hours while the Mac mini is off. The
 * 운영실 and the watchdog outside this machine (worker/scripts/watchdog.mjs)
 * read it too, including how pushes have been going.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from './log.js'
import { ollamaAvailable } from './llm/ollama.js'
import { pushHealth, recordBeat } from './systemHistory.js'

const EVERY_MS = 60_000

export interface HeartbeatDeps {
  modelUp: () => Promise<boolean>
  /** Memos waiting for the model. */
  waiting: () => number
}

export async function beat(deps: HeartbeatDeps): Promise<void> {
  const modelUp = await deps.modelUp()
  const waiting = deps.waiting()
  await getFirestore().doc('system/worker').set({
    lastSeen: FieldValue.serverTimestamp(),
    modelUp,
    waiting,
    push: pushHealth(),
  })
  // The 운영실's last 60 minutes (memory only).
  recordBeat({ at: Date.now(), modelUp, waiting })
}

/** Beat now and every minute. Returns a stop function. */
export function startHeartbeat(waiting: () => number): () => void {
  const deps: HeartbeatDeps = { modelUp: ollamaAvailable, waiting }
  const tick = () => {
    beat(deps).catch((err) => logger.warn('[heartbeat] failed', { err: String(err) }))
  }
  tick()
  const timer = setInterval(tick, EVERY_MS)
  return () => clearInterval(timer)
}
