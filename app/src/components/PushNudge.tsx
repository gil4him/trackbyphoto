import { useEffect, useState } from 'react'
import { useToast } from './Toast'
import { enablePush, pushState, type PushState } from '../lib/push'
import { callWorker } from '../lib/worker'

const DISMISS_KEY = 'tbp.pushNudge.dismissed'

/**
 * "새 사진이 오면 알려드릴까요?" for a family member whose device could get
 * pushes but hasn't been asked. The phone's own permission question appears
 * only after 알림 켜기 is tapped. Shown once: hidden for good after it is
 * closed or answered. Never rendered on a parent's linked phone.
 */
export function PushNudge({ state: forced }: { /** For tests; otherwise detected. */ state?: PushState }) {
  const toast = useToast()
  const [state, setState] = useState<PushState | null>(forced ?? null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  useEffect(() => {
    if (forced === undefined) pushState().then(setState).catch(() => setState('unsupported'))
  }, [forced])

  if (dismissed || state !== 'off') return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
    setDismissed(true)
  }
  const turnOn = async () => {
    setBusy(true)
    try {
      const next = await enablePush()
      if (next === 'on') {
        // In case 앱 알림 was switched off for the whole account earlier.
        await callWorker('setChannels', { push: true }).catch((err) => console.warn('[push] channel not switched on', err))
        toast.show('알림을 켰어요', '새 사진이나 답장이 오면 알려드려요')
        dismiss()
      } else if (next === 'blocked') {
        toast.show('알림이 꺼져 있어요', '휴대폰 설정에서 오늘하루 알림을 허용해 주세요')
        dismiss()
      }
      setState(next)
    } catch (err) {
      console.error('[push] could not switch on', err)
      toast.show('알림을 켜지 못했어요', '잠시 후 알림 탭에서 다시 켜 주세요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="install-hint" role="note">
      <span className="install-msg">새 사진이 오면 알려드릴까요?</span>
      <button className="install-go" disabled={busy} onClick={() => { void turnOn() }}>알림 켜기</button>
      <button className="notice-x" onClick={dismiss} aria-label="나중에">✕</button>
    </div>
  )
}
