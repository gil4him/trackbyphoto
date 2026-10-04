import { useEffect, useState } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { InstallHint } from '../components/InstallHint'
import { NotificationList } from '../components/NotificationList'
import { useToast } from '../components/Toast'
import { useNotificationFeed } from '../hooks/useNotificationFeed'
import { enablePush, pushState, type PushState } from '../lib/push'
import { callWorker, isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import type { AppNotification } from '../types'

const PUSH_HELP: Record<PushState, string> = {
  on: '새 사진이나 음성 답장이 오면 이 기기로 알려드려요.',
  off: '켜면 새 사진이나 음성 답장이 오면 바로 알려드려요.',
  'needs-install': '먼저 홈 화면에 추가해 주세요. 그 아이콘으로 열면 알림을 켤 수 있어요.',
  blocked: '이 브라우저에서 알림이 차단되어 있어요. 브라우저 설정에서 알림을 허용해 주세요.',
  unsupported: '이 앱에서는 아직 알림을 보낼 수 없어요. 웹(trackbyphoto.web.app)을 홈 화면에 추가하면 받을 수 있어요.',
}

/**
 * 알림: every notice addressed to the signed-in person, and how they want to
 * be told. Family only; a parent's linked phone never shows this.
 */
export function Notifications({ uid, onOpen }: { uid: string; onOpen: (n: AppNotification) => void }) {
  const toast = useToast()
  const items = useNotificationFeed(uid)
  const [push, setPush] = useState<PushState | null>(null)
  const [channelPush, setChannelPush] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => { pushState().then(setPush) }, [])
  // The account-wide switch (users/{me}.channels.push, written by the worker).
  useEffect(() => onSnapshot(doc(db, 'users', uid), (snap) => {
    setChannelPush((snap.data()?.channels as { push?: boolean } | undefined)?.push !== false)
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
        if (next === 'blocked') toast.show('알림이 차단되어 있어요', '브라우저 설정에서 허용해 주세요')
      }
    } catch (err) {
      console.error('[push] toggle failed', err)
      toast.show('바꾸지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }

  const open = (n: AppNotification) => {
    if (!n.read) updateDoc(doc(db, 'notifications', n.id), { read: true }).catch((e) => console.warn('[notifications] mark read failed', e))
    onOpen(n)
  }
  const unread = items.filter((n) => !n.read)
  const readAll = () => unread.forEach((n) => updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {}))

  return (
    <section className="page">
      <div className="h-eyebrow">가족 소식</div>
      <h2 className="h-title">알림</h2>

      <InstallHint />

      <div className="sect">
        <div className="sect-lab">알림 받는 방법</div>
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
        <div className="row">
          <div className="who"><b>이메일 요약</b><br /><span>하루 요약을 이메일로 받아요. 곧 제공돼요.</span></div>
          <button className="switch" role="switch" aria-checked={false} disabled aria-label="이메일 요약 전환"><span className="knob" /></button>
        </div>
        <div className="row">
          <div className="who"><b>카카오톡 요약</b> <span className="plan-chip">Basic 이상</span><br /><span>매일 저녁 카카오톡으로 요약을 받아요. 곧 제공돼요.</span></div>
          <button className="switch" role="switch" aria-checked={false} disabled aria-label="카카오톡 요약 전환"><span className="knob" /></button>
        </div>
      </div>

      <div className="sect">
        <div className="sect-lab ntf-head">
          <span>받은 알림</span>
          {unread.length > 0 && <button className="ntf-readall" onClick={readAll}>모두 읽음</button>}
        </div>
        <NotificationList items={items} onOpen={open} />
      </div>
    </section>
  )
}
