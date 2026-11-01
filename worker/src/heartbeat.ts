/**
 * Worker heartbeat.
 *
 * Every 3 minutes the worker stamps system/worker with the time, whether the
 * model answers, and how many memos are waiting, and at once when the model
 * stops or starts answering. Each stamp is a billed write, plus a billed read
 * for every open listener, so it isn't sent more often than something needs
 * (owner, 2026-10-31). It still looks once a minute, in memory only, for the
 * 운영실's 60-minute strip. The app reads the stamp so that a
 * photo whose memo can't be written yet says so ("서버가 쉬는 중이에요")
 * instead of showing "메모 작성 중…" for hours while the Mac mini is off. The
 * 운영실 and the watchdog outside this machine (worker/scripts/watchdog.mjs)
 * read it too, including how pushes have been going.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from './log.js'
import { ollamaAvailable } from './llm/ollama.js'
import { pushHealth, recordBeat } from './systemHistory.js'

const CHECK_EVERY_MS = 60_000
/** Must stay under STALE_MS in app/src/lib/workerStatus.ts and the same 4
 *  minutes in adminInbox.ts: phones already installed call an older stamp
 *  "서버가 쉬는 중". */
export const PUBLISH_EVERY_MS = 3 * 60_000
/** A one-minute timer can fire a moment early; don't let that skip a stamp
 *  and turn 3 minutes into 4. */
const TIMER_SLOP_MS = 5_000

export interface HeartbeatDeps {
  modelUp: () => Promise<boolean>
  /** Memos waiting for the model. */
  waiting: () => number
}

/** The stamp now in Firestore, as far as this process knows. */
export interface Published { at: number; modelUp: boolean }

export function publishDue(last: Published | null, modelUp: boolean, now: number): boolean {
  return !last || modelUp !== last.modelUp || now - last.at >= PUBLISH_EVERY_MS - TIMER_SLOP_MS
}

/** Look at the worker, stamp Firestore if a stamp is due, and return the stamp
 *  now there. A failed write throws, so the next minute tries again. */
export async function beat(deps: HeartbeatDeps, last: Published | null = null): Promise<Published | null> {
  const modelUp = await deps.modelUp()
  const waiting = deps.waiting()
  const at = Date.now()
  let published = last
  if (publishDue(last, modelUp, at)) {
    await getFirestore().doc('system/worker').set({
      lastSeen: FieldValue.serverTimestamp(),
      modelUp,
      waiting,
      push: pushHealth(),
    })
    published = { at, modelUp }
  }
  // The 운영실's last 60 minutes (memory only).
  recordBeat({ at: Date.now(), modelUp, waiting })
  return published
}

/** Beat now and every minute; a beat stamps Firestore only when one is due.
 *  Returns a stop function. */
export function startHeartbeat(waiting: () => number): () => void {
  const deps: HeartbeatDeps = { modelUp: ollamaAvailable, waiting }
  let last: Published | null = null
  const tick = () => {
    beat(deps, last).then((p) => { last = p }, (err) => logger.warn('[heartbeat] failed', { err: String(err) }))
  }
  tick()
  const timer = setInterval(tick, CHECK_EVERY_MS)
  return () => clearInterval(timer)
}
