// Live subscription to the elder's unread safeguard notices (Plan §8).
//
// Only used in the SELF view — the notices belong to the patient and the rules
// only let the patient read them, so we subscribe on the signed-in uid. A
// caregiver looking at someone else's account never sees these.
//
// Two equality filters (patientUid + read) need no composite index; we sort
// newest-first on the client to avoid an orderBy that would.

import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { AppNotification } from '../types'

export function useNotifications(uid: string | undefined) {
  const [unread, setUnread] = useState<AppNotification[]>([])

  useEffect(() => {
    if (!uid) { setUnread([]); return }
    const q = query(
      collection(db, 'notifications'),
      where('patientUid', '==', uid),
      where('read', '==', false),
    )
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppNotification, 'id'>) }))
      rows.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
      setUnread(rows)
    }, (err) => console.error('[notifications] subscription error', err))
    return () => unsub()
  }, [uid])

  const dismiss = (id: string) =>
    updateDoc(doc(db, 'notifications', id), { read: true })
      .catch((e) => console.error('[notifications] dismiss failed', e))

  return { unread, dismiss }
}
