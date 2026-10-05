import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { InstallHint } from '../components/InstallHint'
import { NotificationList } from '../components/NotificationList'
import { useToast } from '../components/Toast'
import { useNotificationFeed } from '../hooks/useNotificationFeed'
import { enablePush, pushState, type PushState } from '../lib/push'
import { callWorker, isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import type { AppNotification, Channels } from '../types'

const inApp = Capacitor.isNativePlatform()
const PUSH_HELP: Record<PushState, string> = {
  on: '새 사진이나 답장이 오면 이 기기로 알려드려요.',
  off: '켜면 새 사진이나 답장이 오면 바로 알려드려요.',
  'needs-install': '먼저 홈 화면에 추가해 주세요. 그 아이콘으로 열면 알림을 켤 수 있어요.',
  blocked: inApp
    ? '휴대폰에서 알림이 꺼져 있어요. 휴대폰 설정 → 오늘하루 → 알림에서 허용해 주세요.'
    : '이 브라우저에서 알림이 차단되어 있어요. 브라우저 설정에서 알림을 허용해 주세요.',
  unsupported: inApp
    ? '이 앱에서는 아직 알림을 보낼 수 없어요. 곧 제공돼요.'
    : '이 브라우저에서는 알림을 보낼 수 없어요.',
}

/**
 * 알림: every notice addressed to the signed-in person, and how they want to
 * be told. Family only; a parent's linked phone never shows this.
 */
export function Notifications({ uid, onOpen, digestOn = false, emailOffered = false, messengerIncluded = false, messengerFrom = null }: {
  uid: string
  onOpen: (n: AppNotification) => void
  /** The digest is rolled out: 이메일 요약 and 카카오톡 요약 can be switched. */
  digestOn?: boolean
  /** E-mail delivery is set up and switched on; otherwise 이메일 요약 isn't shown. */
  emailOffered?: boolean
  /** The plan of the parent being viewed includes messenger delivery. */
  messengerIncluded?: boolean
  /** The lowest plan that includes it ("Plus"); null when no plan does, and
   *  then 카카오톡 요약 isn't offered at all. */
  messengerFrom?: string | null
}) {
  const toast = useToast()
  const items = useNotificationFeed(uid)
  const [push, setPush] = useState<PushState | null>(null)
  const [channels, setChannelsState] = useState<Channels>({})
  const [busy, setBusy] = useState(false)
  // Asking for the number 카카오톡 요약 goes to (first time, or to change it).
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [phone, setPhone] = useState('')

  useEffect(() => { pushState().then(setPush) }, [])
  // The account-wide switch (users/{me}.channels.push, written by the worker).
  useEffect(() => onSnapshot(doc(db, 'users', uid), (snap) => {
    setChannelsState((snap.data()?.channels as Channels | undefined) ?? {})
  }, () => {}), [uid])
  const channelPush = channels.push !== false
  const emailOn = channels.email !== false
  const messengerOn = messengerIncluded && channels.messenger === true

  const change = async (changes: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    try {
      await callWorker('setChannels', changes)
      return true
    } catch (err) {
      console.error('[channels] change failed', err)
      const badNumber = err instanceof Error && err.message.includes('phone number not recognised')
      toast.show('바꾸지 못했어요', badNumber ? '전화번호를 다시 확인해 주세요' : isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
      return false
    } finally {
      setBusy(false)
    }
  }
  const toggleMessenger = () => {
    if (messengerOn) void change({ messenger: false })
    else if (channels.messengerTo) void change({ messenger: true })
    else setPhoneOpen(true)
  }
  const savePhone = async () => {
    if (await change({ messenger: true, phone })) {
      setPhoneOpen(false)
      setPhone('')
    }
  }

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
        {emailOffered && <div className="row">
          <div className="who"><b>이메일 요약</b><br /><span>{digestOn ? '하루 요약을 로그인한 이메일로 받아요.' : '하루 요약을 이메일로 받아요. 곧 제공돼요.'}</span></div>
          <button
            className={`switch ${digestOn && emailOn ? 'on' : ''}`}
            role="switch"
            aria-checked={digestOn && emailOn}
            disabled={!digestOn || busy}
            onClick={() => void change({ email: !emailOn })}
            aria-label="이메일 요약 전환"
          ><span className="knob" /></button>
        </div>}
        {(messengerIncluded || messengerFrom) && <div className="row">
          <div className="who">
            <b>카카오톡 요약</b>{!messengerIncluded && <> <span className="plan-chip">{messengerFrom} 이상</span></>}<br />
            <span>
              {!digestOn ? '매일 저녁 카카오톡으로 요약을 받아요. 곧 제공돼요.'
                : messengerOn ? `매일 저녁 ${channels.messengerTo ?? ''} 번호로 요약 링크를 보내요.`
                : '매일 저녁 카카오톡(또는 문자)으로 요약 링크를 받아요.'}
              {digestOn && messengerIncluded && channels.messengerTo && !phoneOpen && <> <button type="button" className="linklike" onClick={() => setPhoneOpen(true)}>번호 바꾸기</button></>}
            </span>
          </div>
          <button
            className={`switch ${digestOn && messengerOn ? 'on' : ''}`}
            role="switch"
            aria-checked={digestOn && messengerOn}
            disabled={!digestOn || !messengerIncluded || busy}
            onClick={toggleMessenger}
            aria-label="카카오톡 요약 전환"
          ><span className="knob" /></button>
        </div>}
        {digestOn && messengerIncluded && phoneOpen && (
          <form className="dg-phone" onSubmit={(e) => { e.preventDefault(); void savePhone() }}>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="받을 휴대폰 번호 (010-1234-5678)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-label="요약을 받을 휴대폰 번호"
            />
            <button type="submit" disabled={busy || phone.trim().length < 8}>저장</button>
          </form>
        )}
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
