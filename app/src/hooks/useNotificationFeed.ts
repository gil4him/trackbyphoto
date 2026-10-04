import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { AppNotification } from '../types'

/** The signed-in user's recent notices, read and unread, newest first
 *  (notification centre). Only subscribes while `uid` is given. */
export function useNotificationFeed(uid: string | undefined): AppNotification[] {
  const [state, setState] = useState<{ uid: string; items: AppNotification[] } | null>(null)
  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'notifications'), where('recipientUid', '==', uid), orderBy('createdAt', 'desc'), limit(50))
    return onSnapshot(q, (snap) => {
      setState({ uid, items: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppNotification, 'id'>) })) })
    }, (err) => console.error('[notifications] feed error', err))
  }, [uid])
  return state && state.uid === uid ? state.items : []
}
