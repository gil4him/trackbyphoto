import { useEffect, useState } from 'react'
import { watchReactions } from '../lib/reactions'
import type { Reaction } from '../types'

/** Live reactions for a patient; empty while `patientUid` is undefined. */
export function useReactions(patientUid: string | undefined): Reaction[] {
  const [state, setState] = useState<{ uid: string; items: Reaction[] } | null>(null)
  useEffect(() => {
    if (!patientUid) return
    return watchReactions(patientUid, (items) => setState({ uid: patientUid, items }))
  }, [patientUid])
  return state && state.uid === patientUid ? state.items : []
}
