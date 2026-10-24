import { useEffect, useMemo, useState } from 'react'
import { watchFamilyPhotos } from '../lib/familyPhotos'
import type { FamilyPhoto } from '../types'

/**
 * Photos this family member sent, to any of their parents, newest first.
 * Read per parent (the rules allow a parent's family to read that parent's
 * photos), keeping only this sender's.
 */
export function useSentByMe(parentUids: string[], myUid: string | undefined): FamilyPhoto[] {
  const key = parentUids.join(',')
  const [byParent, setByParent] = useState<Record<string, FamilyPhoto[]>>({})
  useEffect(() => {
    if (!myUid || !key) return
    const uids = key.split(',')
    const stops = uids.map((uid) => watchFamilyPhotos(uid, (photos) =>
      setByParent((cur) => ({ ...cur, [uid]: photos.filter((p) => p.senderUid === myUid) }))))
    return () => stops.forEach((s) => s())
  }, [key, myUid])
  return useMemo(() => {
    if (!myUid || !key) return []
    return key.split(',').flatMap((uid) => byParent[uid] ?? []).sort((a, b) => b.createdAtMs - a.createdAtMs)
  }, [byParent, key, myUid])
}
