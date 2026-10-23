// Live view of the worker heartbeat (system/worker). Only subscribes while
// `enabled`, i.e. while a memo on screen is actually waiting to be written.

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { workerStatus, type WorkerBeat, type WorkerStatus } from '../lib/workerStatus'

export function useWorkerStatus(enabled: boolean): WorkerStatus {
  return useWorkerBeat(enabled).status
}

export interface WorkerBeatView {
  status: WorkerStatus
  /** When the last live beat came; null before the first one. */
  lastSeenMs: number | null
  modelUp: boolean | null
  /** Memos waiting for the model, as of the last beat. */
  waiting: number | null
  now: number
}

/** The status plus the beat behind it, re-checked every `tickMs`. The 운영실
 *  shows the age, the model and the queue. */
export function useWorkerBeat(enabled: boolean, tickMs = 30_000): WorkerBeatView {
  const [beat, setBeat] = useState<WorkerBeat | null>(null)
  const [waiting, setWaiting] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    const unsub = onSnapshot(doc(db, 'system', 'worker'), { includeMetadataChanges: true }, (snap) => {
      const d = snap.data()
      const lastSeenMs = d?.lastSeen?.toMillis?.() as number | undefined
      // A cached copy says nothing about now: this phone may be the one offline.
      const live = !!lastSeenMs && !snap.metadata.fromCache
      setBeat(live ? { lastSeenMs, modelUp: d?.modelUp !== false } : null)
      setWaiting(live && typeof d?.waiting === 'number' ? d.waiting : null)
      setNow(Date.now())
    }, (err) => console.error('[worker-status] subscription error', err))
    // No beat arrives from a worker that is off, so re-check on a timer.
    const timer = setInterval(() => setNow(Date.now()), tickMs)
    return () => { unsub(); clearInterval(timer) }
  }, [enabled, tickMs])

  if (!enabled) return { status: 'unknown', lastSeenMs: null, modelUp: null, waiting: null, now }
  return { status: workerStatus(beat, now), lastSeenMs: beat?.lastSeenMs ?? null, modelUp: beat?.modelUp ?? null, waiting, now }
}
