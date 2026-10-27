import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { keepInPhotos } from './gallery'
import { blobToBase64, downloadBlob, photoBlob } from './photoShare'
import { tr } from './lang'
import type { FamilyPhoto } from '../types'

/**
 * A photo the family sent stays on the parent's phone once it has been
 * looked at: in the phone app it goes into the Daylie album like their own
 * photos; in an Android browser it is downloaded (the Files / Photos apps
 * show it); an iPhone browser can't save a picture without the share sheet,
 * so there it is left alone. Each photo once, remembered on the phone.
 */

const KEPT_KEY = 'tbp.familyPhotos.kept'
const KEPT_MAX = 300
const pad = (n: number) => String(n).padStart(2, '0')

/** "Daylie_가족_20261012_2124.jpg", from when it was sent. */
export function keptFileName(p: Pick<FamilyPhoto, 'createdAtMs'>): string {
  const d = new Date(p.createdAtMs)
  const when = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
  return tr(`Daylie_가족_${when}.jpg`, `Daylie_family_${when}.jpg`)
}

/** Where a copy can be kept quietly: the phone app, or an Android browser. */
export function keepsOnThisDevice(ua: string, native: boolean): 'app' | 'download' | 'none' {
  if (native) return 'app'
  return /Android/i.test(ua) ? 'download' : 'none'
}

export function keptIds(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): string[] {
  try {
    const raw = storage?.getItem(KEPT_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function rememberKept(id: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    const ids = keptIds(storage).filter((x) => x !== id)
    ids.push(id)
    storage?.setItem(KEPT_KEY, JSON.stringify(ids.slice(-KEPT_MAX)))
  } catch { /* private mode: it will simply be kept again next time */ }
}

/** Keeps `p` on this phone unless it already is. Never throws. */
export async function keepFamilyPhotoOnDevice(p: FamilyPhoto): Promise<void> {
  if (!p.photoUrl || keptIds().includes(p.id)) return
  const how = keepsOnThisDevice(typeof navigator === 'undefined' ? '' : navigator.userAgent, Capacitor.isNativePlatform())
  if (how === 'none') return
  try {
    const blob = await photoBlob(p.photoUrl)
    const name = keptFileName(p)
    if (how === 'app') {
      const { uri } = await Filesystem.writeFile({ path: `family/${name}`, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true })
      await keepInPhotos(uri)
    } else {
      downloadBlob(blob, name)
    }
    rememberKept(p.id)
  } catch (err) {
    console.warn('[familyPhoto] not kept on this phone', err)
  }
}
