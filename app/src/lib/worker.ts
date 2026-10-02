// Client side of the Mac mini worker request queue (replaces httpsCallable).
//
// callWorker writes requests/{autoId} stamped with the caller's verified
// identity (rules reject the write unless uid/email/name match the auth
// token), waits for the worker to write back status 'done' | 'error', then
// deletes the doc. If the Mac mini is offline nothing answers, so the call
// rejects with a WorkerError('unavailable') after the timeout.

import { addDoc, collection, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'

export class WorkerError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'WorkerError'
  }
}

/** Friendly Korean message for an offline worker. */
export const WORKER_OFFLINE_MESSAGE = '서버가 잠시 오프라인이에요. 잠시 후 다시 시도해 주세요.'

export function isWorkerOffline(err: unknown): boolean {
  return err instanceof WorkerError && err.code === 'unavailable'
}

export async function callWorker<T>(
  type: string,
  payload: Record<string, unknown> = {},
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {},
): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new WorkerError('unauthenticated', 'sign in required')
  // Read name/email from the ID token itself so they match exactly what the
  // rules compare against (displayName can drift from the token's claim).
  const { claims } = await user.getIdTokenResult()
  const ref = await addDoc(collection(db, 'requests'), {
    type,
    uid: user.uid,
    email: (claims.email as string | undefined) ?? null,
    name: (claims.name as string | undefined) ?? null,
    payload,
    status: 'pending',
    createdAt: serverTimestamp(),
  })

  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub()
        reject(new WorkerError('unavailable', WORKER_OFFLINE_MESSAGE))
      }, timeoutMs)
      const unsub = onSnapshot(ref, (snap) => {
        const data = snap.data()
        if (!data || (data.status !== 'done' && data.status !== 'error')) return
        clearTimeout(timer)
        unsub()
        if (data.status === 'done') resolve(data.result as T)
        else reject(new WorkerError(data.code || 'internal', data.message || 'request failed'))
      }, (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  } finally {
    // Collected (or abandoned) — don't leave it in the queue. The worker also
    // purges anything older than a day in case this delete never runs.
    deleteDoc(ref).catch(() => {})
  }
}
