import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import { enablePush, pushState, type PushState } from '../lib/push'
import { callWorker, isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { tr } from '../lib/lang'
import type { Channels } from '../types'

const inApp = Capacitor.isNativePlatform()
const PUSH_HELP: Record<PushState, string> = {
  on: tr('새 사진이나 답장이 오면 이 기기로 알려드려요.', 'This device gets a note when a new photo or reply arrives.'),
  off: tr('켜면 새 사진이나 답장이 오면 바로 알려드려요.', 'Turn it on and we tell you as soon as a photo or reply arrives.'),
  'needs-install': tr('먼저 홈 화면에 추가해 주세요. 그 아이콘으로 열면 알림을 켤 수 있어요.', 'Add Daylie to your home screen first. Open it from that icon to turn alerts on.'),
  blocked: inApp
    ? tr('휴대폰에서 알림이 꺼져 있어요. 휴대폰 설정 → Daylie → 알림에서 허용해 주세요.', 'Alerts are off on your phone. Allow them in Settings → Daylie → Notifications.')
    : tr('이 브라우저에서 알림이 차단되어 있어요. 브라우저 설정에서 알림을 허용해 주세요.', 'This browser is blocking alerts. Allow notifications in its settings.'),
  unsupported: inApp
    ? tr('이 앱에서는 아직 알림을 보낼 수 없어요. 곧 제공돼요.', "This app can't send alerts yet. Coming soon.")
    : tr('이 브라우저에서는 알림을 보낼 수 없어요.', "This browser can't show alerts."),
}

/**
 * The 앱 알림 row: this device's push permission and the account-wide switch
 * (users/{me}.channels.push, written by the worker) as one toggle. On the
 * 알림 page in the full edition; under 설정 › 알림 in the simple edition.
 */
export function PushToggle({ uid }: { uid: string }) {
  const toast = useToast()
  const [push, setPush] = useState<PushState | null>(null)
  const [channelPush, setChannelPush] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => { pushState().then(setPush) }, [])
  useEffect(() => onSnapshot(doc(db, 'users', uid), (snap) => {
    setChannelPush(((snap.data()?.channels as Channels | undefined) ?? {}).push !== false)
  }, () => {}), [uid])

  const pushOn = push === 'on' && channelPush
  const canToggle = push === 'on' || push === 'off'

  const togglePush = async () => {
    setBusy(true)
    try {
      if (pushOn) {
        await callWorker('setChannels', { push: false })
      } else {
        const next = await enablePush()
        setPush(next)
        if (next === 'on' && !channelPush) await callWorker('setChannels', { push: true })
        if (next === 'blocked') toast.show(
          tr('알림이 차단되어 있어요', 'Alerts are blocked'),
          inApp ? tr('휴대폰 설정에서 허용해 주세요', 'Please allow them in your phone settings') : tr('브라우저 설정에서 허용해 주세요', 'Please allow them in your browser settings'),
        )
      }
    } catch (err) {
      console.error('[push] toggle failed', err)
      toast.show(tr('바꾸지 못했어요', "Couldn't change it"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="row">
      <div className="who"><b>{tr('앱 알림', 'App alerts')}</b><br /><span>{push ? PUSH_HELP[pushOn ? 'on' : push === 'on' ? 'off' : push] : tr('확인하는 중…', 'Checking…')}</span></div>
      <button
        className={`switch ${pushOn ? 'on' : ''}`}
        role="switch"
        aria-checked={pushOn}
        disabled={busy || !canToggle}
        onClick={togglePush}
        aria-label={tr('앱 알림 전환', 'App alerts switch')}
      ><span className="knob" /></button>
    </div>
  )
}
