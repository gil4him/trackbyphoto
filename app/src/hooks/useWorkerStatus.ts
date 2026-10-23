// Live view of the worker heartbeat (system/worker). Only subscribes while
// `enabled`, i.e. while a memo on screen is actually waiting to be written.

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { workerStatus, type WorkerBeat, type WorkerStatus } from '../lib/workerStatus'

export function useWorkerStatus(enabled: boolean): WorkerStatus {
  return useWorkerBeat(enabled).status
}

/** The status plus when the last beat came (null before the first live one),
 *  re-checked every `tickMs`. The 운영실 footer shows the age. */
export function useWorkerBeat(enabled: boolean, tickMs = 30_000): { status: WorkerStatus; lastSeenMs: number | null; now: number } {
  const [beat, setBeat] = useState<WorkerBeat | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    const unsub = onSnapshot(doc(db, 'system', 'worker'), { includeMetadataChanges: true }, (snap) => {
      const d = snap.data()
      const lastSeenMs = d?.lastSeen?.toMillis?.() as number | undefined
      // A cached copy says nothing about now: this phone may be the one offline.
      setBeat(lastSeenMs && !snap.metadata.fromCache ? { lastSeenMs, modelUp: d?.modelUp !== false } : null)
      setNow(Date.now())
    }, (err) => console.error('[worker-status] subscription error', err))
    // No beat arrives from a worker that is off, so re-check on a timer.
    const timer = setInterval(() => setNow(Date.now()), tickMs)
    return () => { unsub(); clearInterval(timer) }
  }, [enabled, tickMs])

  return { status: enabled ? workerStatus(beat, now) : 'unknown', lastSeenMs: enabled ? beat?.lastSeenMs ?? null : null, now }
}
