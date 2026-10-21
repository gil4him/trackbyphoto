import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { Memo } from '../types'

/**
 * The latest memos of every parent at once, for the family dashboard
 * (docs/DAYLIE_V3_UI_FIX.md A10): one live query per parent, newest first.
 * Enough for today's count and thumbnails and yesterday's count. Pass an
 * empty list to subscribe to nothing. A parent who drops off the list keeps
 * a stale entry until the next sign-in; nothing reads it.
 */
export function useParentsMemos(patientUids: string[], max = 40): Record<string, Memo[]> {
  const [byUid, setByUid] = useState<Record<string, Memo[]>>({})
  const key = [...patientUids].sort().join(',')
  useEffect(() => {
    const uids = key ? key.split(',') : []
    const unsubs = uids.map((uid) =>
      onSnapshot(
        query(collection(db, 'memos'), where('patientUid', '==', uid), orderBy('takenAt', 'desc'), limit(max)),
        (snap) => setByUid((prev) => ({ ...prev, [uid]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Memo, 'id'>) })) })),
        (err) => console.error('[memos] parent subscription error', uid, err),
      ))
    return () => { unsubs.forEach((u) => u()) }
  }, [key, max])
  return byUid
}
