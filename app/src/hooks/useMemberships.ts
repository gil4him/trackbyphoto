// Live subscription to caregiver-share memberships, viewed from both sides.
//
// A signed-in user can simultaneously be:
//   - a patient (어르신) with caregivers attached — `caregivers` is the
//     list of rows where patientUid == self
//   - a caregiver on other patients — `patients` is the list of rows where
//     caregiverUid == self
//
// Both lists are surfaced so the UI can render the management section in
// Settings (caregivers) and the patient-context switcher (patients).
//
// Pending invites (`status: 'invited'`) are kept in the lists — the UI shows
// them with a "초대됨" badge so the patient can see who hasn't accepted yet.
// Revoked rows are filtered out: they exist only as an audit trail and have
// no live access.

import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { Membership } from '../types'

type LiveMembership = Membership & { id: string }

export function useMemberships(uid: string | undefined) {
  const [caregivers, setCaregivers] = useState<LiveMembership[]>([])
  const [patients, setPatients] = useState<LiveMembership[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setCaregivers([]); setPatients([]); setLoading(false); return }
    setLoading(true)

    // Filter revoked out client-side rather than via where(status, '!=', 'revoked')
    // — Firestore only supports a single inequality per query and we may want
    // to add another later (e.g., expiresAt > now). Two-line filter is cheap.
    const keep = (rows: LiveMembership[]) => rows.filter((r) => r.status !== 'revoked')

    const qCaregivers = query(
      collection(db, 'memberships'),
      where('patientUid', '==', uid),
    )
    const qPatients = query(
      collection(db, 'memberships'),
      where('caregiverUid', '==', uid),
      where('status', '==', 'active'),
    )

    let cgReady = false, ptReady = false
    const markReady = () => { if (cgReady && ptReady) setLoading(false) }

    const unsub1 = onSnapshot(qCaregivers, (snap) => {
      setCaregivers(keep(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Membership) }))))
      cgReady = true; markReady()
    }, (err) => {
      console.error('[memberships] caregivers subscription error', err)
      cgReady = true; markReady()
    })
    const unsub2 = onSnapshot(qPatients, (snap) => {
      setPatients(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Membership) })))
      ptReady = true; markReady()
    }, (err) => {
      console.error('[memberships] patients subscription error', err)
      ptReady = true; markReady()
    })

    return () => { unsub1(); unsub2() }
  }, [uid])

  return { caregivers, patients, loading }
}

export type { LiveMembership }
