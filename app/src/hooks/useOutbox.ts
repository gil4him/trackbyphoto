import { useEffect, useMemo, useState } from 'react'
import { outbox } from '../lib/outboxBackend'
import { voiceOutbox } from '../lib/voiceOutbox'
import type { OutboxItem } from '../lib/outbox'

/** Photos of this user still waiting on the phone, newest first. */
export function useOutbox(uid: string | undefined): OutboxItem[] {
  const [all, setAll] = useState<OutboxItem[]>([])
  useEffect(() => outbox.subscribe(setAll), [])
  return useMemo(() => (uid ? all.filter((i) => i.uid === uid) : []), [all, uid])
}

/**
 * Keep sending this user's waiting photos and voice replies: now, whenever the connection
 * returns, and whenever the app comes back to the foreground. Mount once.
 */
export function useOutboxSync(uid: string | undefined) {
  useEffect(() => {
    if (!uid) return
    const retry = () => { void outbox.retryNow(uid); void voiceOutbox.retryNow(uid) }
    const onVisible = () => { if (document.visibilityState === 'visible') retry() }
    retry()
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [uid])
}
