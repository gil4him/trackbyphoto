import { useEffect, useState } from 'react'
import { watchFamilyPhotos } from '../lib/familyPhotos'
import type { FamilyPhoto } from '../types'

/** A parent's family photos, live; empty while not switched on. */
export function useFamilyPhotos(patientUid: string | undefined): FamilyPhoto[] {
  // Kept with whose they are, so a stale list never shows for someone else.
  const [state, setState] = useState<{ uid: string; photos: FamilyPhoto[] } | null>(null)
  useEffect(() => {
    if (!patientUid) return
    return watchFamilyPhotos(patientUid, (photos) => setState({ uid: patientUid, photos }))
  }, [patientUid])
  return patientUid && state?.uid === patientUid ? state.photos : []
}
