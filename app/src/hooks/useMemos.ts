import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore'
import { db } from '../firebase'
import type { Memo } from '../types'

/** Live subscription to a patient's memos (most recent first). For a
 *  self-managed account pass the signed-in user's uid; once caregiver-share
 *  ships, pass the patient's uid the caregiver has an active membership on. */
export function useMemos(patientUid: string | undefined, max = 60) {
  const [memos, setMemos] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!patientUid) { setMemos([]); setLoading(false); return }
    const q = query(
      collection(db, 'memos'),
      where('patientUid', '==', patientUid),
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
  }, [patientUid, max])

  return { memos, loading }
}
