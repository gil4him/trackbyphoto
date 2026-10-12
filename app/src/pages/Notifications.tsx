import { useEffect, useState } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { InstallHint } from '../components/InstallHint'
import { NotificationList } from '../components/NotificationList'
import { PushNudge } from '../components/PushNudge'
import { PushToggle } from '../components/PushToggle'
import { useToast } from '../components/Toast'
import { useNotificationFeed } from '../hooks/useNotificationFeed'
import { isSimple } from '../lib/edition'
import { callWorker, isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import type { AppNotification, Channels } from '../types'

/**
 * 알림: every notice addressed to the signed-in person and, in the full
 * edition, how they want to be told. In the simple edition it is the list
 * alone (the 앱 알림 switch lives under 설정 › 알림), with the 알림 켜기
 * nudge on top while push is off. Family only; a parent's linked phone
 * never shows this.
 */
export function Notifications({ uid, onOpen, digestOn = false, emailOffered = false, messengerIncluded = false, messengerFrom = null, pushRollout = false }: {
  uid: string
  onOpen: (n: AppNotification) => void
  /** Family push is rolled out: the simple edition shows the 알림 켜기 nudge. */
  pushRollout?: boolean
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
  const [channels, setChannelsState] = useState<Channels>({})
  const [busy, setBusy] = useState(false)
  // Asking for the number 카카오톡 요약 goes to (first time, or to change it).
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [phone, setPhone] = useState('')

  // The account-wide channels (users/{me}.channels, written by the worker).
  useEffect(() => onSnapshot(doc(db, 'users', uid), (snap) => {
    setChannelsState((snap.data()?.channels as Channels | undefined) ?? {})
  }, () => {}), [uid])
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

  const open = (n: AppNotification) => {
    if (!n.read) updateDoc(doc(db, 'notifications', n.id), { read: true }).catch((e) => console.warn('[notifications] mark read failed', e))
    onOpen(n)
  }
  const unread = items.filter((n) => !n.read)
  const readAll = () => unread.forEach((n) => updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {}))

  if (isSimple()) {
    return (
      <section className="page">
        <div className="h-eyebrow">가족 소식</div>
        <h2 className="h-title">알림</h2>
        {pushRollout && <PushNudge />}
        <div className="sect">
          <div className="sect-lab ntf-head">
            <span>받은 알림</span>
            {unread.length > 0 && <button className="ntf-readall" onClick={readAll}>모두 읽음</button>}
          </div>
          <NotificationList items={items} onOpen={open} grouped />
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="h-eyebrow">가족 소식</div>
      <h2 className="h-title">알림</h2>

      <InstallHint />

      <div className="sect">
        <div className="sect-lab">알림 받는 방법</div>
        <PushToggle uid={uid} />
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
