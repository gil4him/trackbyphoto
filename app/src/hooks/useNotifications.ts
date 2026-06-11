// Live subscription to the signed-in user's unread notices.
//
// Addressed by `recipientUid`, so this one feed covers both the elder's §8
// safeguard notices AND a caregiver's new-photo notices — whatever is addressed
// to the current uid, in any view.
//
// Two equality filters (recipientUid + read) need no composite index; we sort
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
      where('recipientUid', '==', uid),
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
