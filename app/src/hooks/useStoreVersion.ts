// The latest store version per platform (system/app, worker-written).

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import type { StoreVersions } from '../lib/appVersion'

export function useStoreVersion(enabled = true): StoreVersions {
  const [latest, setLatest] = useState<StoreVersions>({})
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(doc(db, 'system', 'app'), (snap) => {
      const d = snap.data()
      const pick = (p: 'ios' | 'android') => (typeof d?.[p]?.version === 'string' ? d[p].version as string : undefined)
      setLatest({ ios: pick('ios'), android: pick('android') })
    }, (err) => console.warn('[store-version] subscription', err))
  }, [enabled])
  return latest
}
