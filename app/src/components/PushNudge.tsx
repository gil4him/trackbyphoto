import { useEffect, useState } from 'react'
import { useToast } from './Toast'
import { enablePush, pushState, type PushState } from '../lib/push'
import { callWorker } from '../lib/worker'
import { tr } from '../lib/lang'
import { NUDGE_DISMISS_KEY as DISMISS_KEY, nudgeDismissed, nudgeDismissValue } from '../lib/nudge'

/**
 * "새 사진이 오면 알려드릴까요?" for a family member whose device could get
 * pushes but hasn't been asked. The phone's own permission question appears
 * only after 알림 켜기 is tapped. Closing it (or answering) hides it for a
 * week. Never rendered on a parent's linked phone.
 */
export function PushNudge({ state: forced }: { /** For tests; otherwise detected. */ state?: PushState }) {
  const toast = useToast()
  const [state, setState] = useState<PushState | null>(forced ?? null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return nudgeDismissed(localStorage.getItem(DISMISS_KEY)) } catch { return false }
  })
  useEffect(() => {
    if (forced === undefined) pushState().then(setState).catch(() => setState('unsupported'))
  }, [forced])

  if (dismissed || state !== 'off') return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, nudgeDismissValue()) } catch { /* private mode */ }
    setDismissed(true)
  }
  const turnOn = async () => {
    setBusy(true)
    try {
      const next = await enablePush()
      if (next === 'on') {
        // In case 앱 알림 was switched off for the whole account earlier.
        await callWorker('setChannels', { push: true }).catch((err) => console.warn('[push] channel not switched on', err))
        toast.show(tr('알림을 켰어요', 'Alerts are on'), tr('새 사진이나 답장이 오면 알려드려요', "We'll tell you when a new photo or reply arrives"))
        dismiss()
      } else if (next === 'blocked') {
        toast.show(tr('알림이 꺼져 있어요', 'Alerts are off'), tr('휴대폰 설정에서 Daylie 알림을 허용해 주세요', 'Please allow Daylie alerts in your phone settings'))
        dismiss()
      }
      setState(next)
    } catch (err) {
      console.error('[push] could not switch on', err)
      toast.show(tr('알림을 켜지 못했어요', "Couldn't turn alerts on"), tr('잠시 후 알림 탭에서 다시 켜 주세요', 'Please try again from the Alerts tab in a moment'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="install-hint" role="note">
      <span className="install-msg">{tr('새 사진이 오면 알려드릴까요?', 'Want a note when a new photo arrives?')}</span>
      <button className="install-go" disabled={busy} onClick={() => { void turnOn() }}>{tr('알림 켜기', 'Turn on alerts')}</button>
      <button className="notice-x" onClick={dismiss} aria-label={tr('나중에', 'Later')}>✕</button>
    </div>
  )
}
