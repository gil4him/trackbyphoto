import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { Memo } from '../types'

export type MemoByIdState = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

/** One photo's record: ready, missing (gone, or not this person's to see) or error. */
export async function readMemo(memoId: string): Promise<{ memo: Memo | null; state: MemoByIdState }> {
  try {
    const snap = await getDoc(doc(db, 'memos', memoId))
    return snap.exists() ? { memo: { id: snap.id, ...(snap.data() as Omit<Memo, 'id'>) }, state: 'ready' } : { memo: null, state: 'missing' }
  } catch (err) {
    // Not allowed reads the same as gone: nothing to show either way.
    if ((err as { code?: string })?.code === 'permission-denied') return { memo: null, state: 'missing' }
    console.warn('[memo] read failed', err)
    return { memo: null, state: 'error' }
  }
}

/**
 * One photo read straight from the server, for a tapped notification: much
 * quicker than waiting for that person's whole photo list. `memoId` null
 * reads nothing (the photo is already in the list). Change `attempt` to try
 * again.
 */
export function useMemoById(memoId: string | null, enabled: boolean, attempt = 0): { memo: Memo | null; state: MemoByIdState } {
  const [got, setGot] = useState<{ key: string; memo: Memo | null; state: MemoByIdState } | null>(null)
  const key = memoId && enabled ? `${memoId}#${attempt}` : null

  useEffect(() => {
    if (!key || !memoId) return
    let live = true
    void readMemo(memoId).then((r) => { if (live) setGot({ key, ...r }) })
    return () => { live = false }
  }, [key, memoId])

  if (!key) return { memo: null, state: 'idle' }
  return got?.key === key ? { memo: got.memo, state: got.state } : { memo: null, state: 'loading' }
}
