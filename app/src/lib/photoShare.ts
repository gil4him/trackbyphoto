import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { fmtDate, fmtTime } from '../util'
import { tr } from './lang'
import type { Memo } from '../types'
import { rotateBlob } from './image'

/**
 * 공유하기 on a photo (MemoDetail's ⋯, family only, simple edition).
 * Phone app: the photo goes to the share sheet as a file — KakaoTalk, and on
 * an iPhone 이미지 저장. Phone browser: the browser's share sheet when it can
 * take files, else a download. Fetching the photo needs CORS on the Storage
 * bucket (cors.json).
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** "Daylie_20261009_1430.jpg", from when it was taken. */
export function photoFileName(memo: Pick<Memo, 'takenAt'>): string {
  const d = memo.takenAt.toDate()
  return `Daylie_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.jpg`
}

/** The line that goes with it: "[Daylie] 10월 9일 (금) 오후 2:30 · 서초동" + the memo. */
export function photoShareText(memo: Pick<Memo, 'takenAt' | 'place' | 'memo'>): string {
  const d = memo.takenAt.toDate()
  const head = `[Daylie] ${fmtDate(d)} ${fmtTime(d)}${memo.place ? ` · ${memo.place}` : ''}`
  return memo.memo ? `${head}\n${memo.memo}` : head
}

export async function photoBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`photo ${res.status}`)
  return res.blob()
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 'cancelled' when the sheet was closed without picking anything.
 *  `turn`: a rotation not yet saved into the stored photo (photoRotate.ts). */
export async function sharePhoto(memo: Memo, turn = 0): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const stored = await photoBlob(memo.photoUrl)
  const blob = turn ? await rotateBlob(stored, turn) : stored
  const name = photoFileName(memo)
  const text = photoShareText(memo)
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: `share/${name}`,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    })
    try {
      await Share.share({ files: [uri], text, dialogTitle: tr('사진 보내기', 'Send photo') })
    } catch {
      return 'cancelled' // the sheet reports closing as an error
    }
    return 'shared'
  }
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled'
      throw err
    }
    return 'shared'
  }
  downloadBlob(blob, name)
  return 'downloaded'
}
