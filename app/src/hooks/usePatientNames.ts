import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import type { NameState } from '../lib/people'
import type { UserSettings } from '../types'

export type FamilyPhotosSetting = UserSettings['familyPhotos']

/**
 * The display name of each person the signed-in user looks after, from
 * users/{patientUid}.patientName (the field 설정 edits), kept live.
 *
 * A name is `null` only when the server has said the account's settings
 * aren't there (or refuses the read); an answer from the phone's own empty
 * cache, as on a slow connection, leaves it undefined: not known yet.
 */
export function usePatientNames(patientUids: string[]): Record<string, NameState> {
  return usePatientDocs(patientUids).names
}

/** The same live reads, also keeping each person's 가족 사진 setting (who may
 *  send them photos), so family can send from their own home. */
export function usePatientDocs(patientUids: string[]): { names: Record<string, NameState>; familyPhotos: Record<string, FamilyPhotosSetting> } {
  const [names, setNames] = useState<Record<string, NameState>>({})
  const [familyPhotos, setFamilyPhotos] = useState<Record<string, FamilyPhotosSetting>>({})
  const key = [...patientUids].sort().join(',')
  useEffect(() => {
    const uids = key ? key.split(',') : []
    const unsubs = uids.map((uid) =>
      onSnapshot(doc(db, 'users', uid), { includeMetadataChanges: true }, (snap) => {
        const next: NameState = snap.exists()
          ? ((snap.data()?.patientName as string | undefined) || '이름 없음')
          : snap.metadata.fromCache ? undefined : null
        setNames((prev) => (prev[uid] === next ? prev : { ...prev, [uid]: next }))
        const fp = snap.data()?.familyPhotos as FamilyPhotosSetting
        setFamilyPhotos((prev) => (JSON.stringify(prev[uid]) === JSON.stringify(fp) ? prev : { ...prev, [uid]: fp }))
      }, (err) => {
        console.warn('[people] name subscription error', uid, err)
        setNames((prev) => ({ ...prev, [uid]: null }))
      }),
    )
    return () => { unsubs.forEach((u) => u()) }
  }, [key])
  return { names, familyPhotos }
}
