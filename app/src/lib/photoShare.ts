import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { fmtDate, fmtTime } from '../util'
import type { Memo } from '../types'

/**
 * 공유하기 / 저장 on a photo (MemoDetail, family only, simple edition).
 * Phone app: the photo goes to the share sheet as a file — KakaoTalk, and on
 * an iPhone 이미지 저장. Phone browser: the browser's share sheet when it can
 * take files, else a download. Fetching the photo needs CORS on the Storage
 * bucket (cors.json).
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** "오늘하루_20261009_1430.jpg", from when it was taken. */
export function photoFileName(memo: Pick<Memo, 'takenAt'>): string {
  const d = memo.takenAt.toDate()
  return `오늘하루_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.jpg`
}

/** The line that goes with it: "[오늘하루] 10월 9일 (금) 오후 2:30 · 서초동" + the memo. */
export function photoShareText(memo: Pick<Memo, 'takenAt' | 'place' | 'memo'>): string {
  const d = memo.takenAt.toDate()
  const head = `[오늘하루] ${fmtDate(d)} ${fmtTime(d)}${memo.place ? ` · ${memo.place}` : ''}`
  return memo.memo ? `${head}\n${memo.memo}` : head
}

async function photoBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`photo ${res.status}`)
  return res.blob()
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 'cancelled' when the sheet was closed without picking anything. */
export async function sharePhoto(memo: Memo): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await photoBlob(memo.photoUrl)
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
      await Share.share({ files: [uri], text, dialogTitle: '사진 보내기' })
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

/** 저장 in a browser: download the photo. */
export async function downloadPhoto(memo: Memo): Promise<void> {
  downloadBlob(await photoBlob(memo.photoUrl), photoFileName(memo))
}
