import { useRef, useState, type ReactNode } from 'react'
import { useToast } from '../components/Toast'
import { Processing } from '../components/Processing'
import { savePhoto, captureNativePhoto, isNativeApp } from '../lib/capture'
import { warmUpLocation } from '../lib/location'
import { noteCaptureStarted } from './useAppUpdate'

/**
 * Taking a photo for `uid`'s own record: the phone's camera in the app, the
 * file picker (camera first) on the web, then savePhoto with a toast. Home's
 * 사진 찍기 and the floating camera button (CameraFab) share it. Render
 * `inputEl` and `processing` once where the hook is used.
 */
export function useCapture(uid: string, { savedSub = '가족에게 보내는 중이에요' }: { savedSub?: string } = {}): {
  takePhoto: () => void
  busy: boolean
  inputEl: ReactNode
  processing: ReactNode
} {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const onPick = async (file: File, nativePath?: string) => {
    setBusy(true)
    try {
      await savePhoto({ uid, file, nativePath })
      // The outbox sends it and the worker writes the memo.
      toast.show('사진을 저장했어요', savedSub)
    } catch (err) {
      console.error(err)
      toast.show('사진을 저장하지 못했어요', '다시 한 번 찍어 주세요')
    } finally {
      setBusy(false)
    }
  }

  const takePhoto = () => {
    warmUpLocation()
    noteCaptureStarted()
    if (isNativeApp) {
      captureNativePhoto()
        .then(({ file, path }) => onPick(file, path))
        .catch((err) => console.warn('[capture] native camera cancelled or failed', err))
    } else {
      inputRef.current?.click()
    }
  }

  const inputEl = (
    <input
      ref={inputRef}
      className="hidden-input"
      type="file"
      accept="image/*"
      capture="environment"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) void onPick(f)
        e.currentTarget.value = ''
      }}
    />
  )
  const processing = <Processing show={busy} message="사진을 저장하고 있어요…" sub="시간 · 장소 · 활동을 자동으로 적어요" />

  return { takePhoto, busy, inputEl, processing }
}
