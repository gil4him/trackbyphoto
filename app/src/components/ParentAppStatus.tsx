import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import { useStoreVersion } from '../hooks/useStoreVersion'
import { appStatus, storeUrlForPlatform } from '../lib/appVersion'
import { callWorker, isWorkerOffline, WorkerError, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { shareStoreLink } from '../lib/share'
import { honorific } from '../lib/people'
import { tr } from '../lib/lang'
import type { ElderDevice } from '../types'

/**
 * The parent's app version in family's Settings: "옛 버전이에요" with
 * 업데이트 알림 보내기 (a push to the parent's phone, managers only, once a
 * day; worker sendUpdateNudge) and 링크 보내기 (the store link through
 * KakaoTalk or the share sheet).
 */
export function ParentAppStatus({ patientUid, patientName, canManage }: { patientUid: string; patientName: string; canManage: boolean }) {
  const toast = useToast()
  const [device, setDevice] = useState<ElderDevice | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const latest = useStoreVersion()

  useEffect(() => onSnapshot(
    collection(db, 'users', patientUid, 'devices'),
    (snap) => setDevice(snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<ElderDevice, 'id'>) }))
      .find((d) => d.status === 'active')),
    (err) => console.error('[devices] subscription', err),
  ), [patientUid])

  const status = appStatus(device, latest)
  if (status.kind === 'none') return null
  const who = honorific(patientName)

  if (status.kind === 'current') {
    return <div className="app-status"><span>{tr(`앱 ${status.version} · 최신 버전`, `App ${status.version} · up to date`)}</span></div>
  }

  const nudge = async () => {
    setBusy(true)
    try {
      await callWorker('sendUpdateNudge', { patientUid })
      toast.show(tr('업데이트 알림을 보냈어요', 'Update notice sent'))
    } catch (err) {
      const code = err instanceof WorkerError ? err.code : ''
      if (code === 'resource-exhausted') toast.show(tr('오늘은 이미 보냈어요', 'Already sent today'), tr('내일 다시 보낼 수 있어요', 'You can send it again tomorrow'))
      else if (code === 'failed-precondition' && /up to date/.test((err as Error).message)) toast.show(tr('이미 최신 버전이에요', "It's already up to date"))
      else if (code === 'failed-precondition') toast.show(tr('알림을 받을 수 없는 휴대폰이에요', "That phone can't get notices"), tr('링크 보내기로 알려 주세요', 'Send the link instead'))
      else {
        console.error('[update] notice not sent', err)
        toast.show(tr('보내지 못했어요', "Couldn't send it"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
      }
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    const url = storeUrlForPlatform(status.platform)
    if (!url) return
    try {
      if ((await shareStoreLink(patientName, url)) === 'copied') toast.show(tr('링크를 복사했어요', 'Link copied'))
    } catch (err) {
      console.error('[update] link not shared', err)
    }
  }

  return (
    <div className="app-status">
      <span className={status.kind === 'behind' ? 'app-status-old' : undefined}>
        {status.kind === 'behind'
          ? tr(`${who} 휴대폰 앱이 옛 버전이에요`, `${who}'s phone has an old version of the app`)
          : tr('앱 버전 확인 안 됨', 'App version unknown')}
      </span>
      <div className="app-status-actions">
        {canManage && <button type="button" disabled={busy} onClick={nudge}>{tr('업데이트 알림 보내기', 'Send update notice')}</button>}
        <button type="button" onClick={share}>{tr('링크 보내기', 'Send the link')}</button>
      </div>
    </div>
  )
}
