import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore'
import { db } from '../firebase'
import type { Memo } from '../types'

/** Live subscription to the current user's memos (most recent first). */
export function useMemos(uid: string | undefined, max = 60) {
  const [memos, setMemos] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setMemos([]); setLoading(false); return }
    const q = query(
      collection(db, 'memos'),
      where('uid', '==', uid),
      orderBy('takenAt', 'desc'),
      limit(max),
    )
    const unsub = onSnapshot(q, (snap) => {
      setMemos(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Memo, 'id'>) })))
      setLoading(false)
    }, (err) => {
      console.error('[memos] subscription error', err)
      setLoading(false)
    })
    return () => unsub()
  }, [uid, max])

  return { memos, loading }
}
