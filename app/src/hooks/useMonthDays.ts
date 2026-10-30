import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { monthDays, monthDaysLine } from '../lib/monthDays'

/**
 * "이번 달 12일째 기록 중" (owner decision, 2026-10-30): its own query, because
 * the photo lists stop at their newest few and a count from those could go
 * down. Null until there is something to say, or without `patientUid`.
 */
export function useMonthDaysLine(patientUid: string | null | undefined): string | null {
  const [state, setState] = useState<{ uid: string; days: number } | null>(null)
  useEffect(() => {
    if (!patientUid) return
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const q = query(collection(db, 'memos'), where('patientUid', '==', patientUid), where('takenAt', '>=', start), orderBy('takenAt', 'desc'))
    return onSnapshot(q, (snap) => {
      setState({ uid: patientUid, days: monthDays(snap.docs.map((d) => d.data() as { takenAt?: { toDate?: () => Date }; status?: string }), new Date()) })
    }, (err) => console.warn('[monthDays] subscription error', err))
  }, [patientUid])
  return state && state.uid === patientUid ? monthDaysLine(state.days) : null
}
