import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import { enablePush, pushState, type PushState } from '../lib/push'
import { callWorker, isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import type { Channels } from '../types'

const inApp = Capacitor.isNativePlatform()
const PUSH_HELP: Record<PushState, string> = {
  on: '새 사진이나 답장이 오면 이 기기로 알려드려요.',
  off: '켜면 새 사진이나 답장이 오면 바로 알려드려요.',
  'needs-install': '먼저 홈 화면에 추가해 주세요. 그 아이콘으로 열면 알림을 켤 수 있어요.',
  blocked: inApp
    ? '휴대폰에서 알림이 꺼져 있어요. 휴대폰 설정 → Daylie → 알림에서 허용해 주세요.'
    : '이 브라우저에서 알림이 차단되어 있어요. 브라우저 설정에서 알림을 허용해 주세요.',
  unsupported: inApp
    ? '이 앱에서는 아직 알림을 보낼 수 없어요. 곧 제공돼요.'
    : '이 브라우저에서는 알림을 보낼 수 없어요.',
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
        if (next === 'blocked') toast.show('알림이 차단되어 있어요', inApp ? '휴대폰 설정에서 허용해 주세요' : '브라우저 설정에서 허용해 주세요')
      }
    } catch (err) {
      console.error('[push] toggle failed', err)
      toast.show('바꾸지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="row">
      <div className="who"><b>앱 알림</b><br /><span>{push ? PUSH_HELP[pushOn ? 'on' : push === 'on' ? 'off' : push] : '확인하는 중…'}</span></div>
      <button
        className={`switch ${pushOn ? 'on' : ''}`}
        role="switch"
        aria-checked={pushOn}
        disabled={busy || !canToggle}
        onClick={togglePush}
        aria-label="앱 알림 전환"
      ><span className="knob" /></button>
    </div>
  )
}
