import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import { isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { approvePairing, unlinkDevice } from '../lib/pairing'
import { PairingSender } from '../pages/RegisterElder'
import type { ElderDevice, Pairing } from '../types'
import { SectLab } from './SectLab'
import { honorific } from '../lib/people'
import { tr } from '../lib/lang'
import { ParentAppStatus } from './ParentAppStatus'

/**
 * 기기 관리 for a family-managed elder (Settings, family view): linked phones
 * with 연결 해제, pending re-link requests to approve, and 새 휴대폰 연결.
 */
export function ElderDevices({ patientUid, patientName }: { patientUid: string; patientName: string }) {
  const toast = useToast()
  const [devices, setDevices] = useState<ElderDevice[]>([])
  const [requests, setRequests] = useState<Pairing[]>([])
  const [sending, setSending] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState<ElderDevice | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsubDevices = onSnapshot(
      collection(db, 'users', patientUid, 'devices'),
      (snap) => setDevices(snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ElderDevice, 'id'>) }))
        .filter((d) => d.status === 'active')),
      (err) => console.error('[devices] subscription', err),
    )
    const unsubRequests = onSnapshot(
      query(collection(db, 'pairings'), where('patientUid', '==', patientUid), where('status', '==', 'awaiting-approval')),
      (snap) => setRequests(snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Pairing, 'id'>) }))
        .filter((p) => p.expiresAt.toMillis() > Date.now())),
      (err) => console.error('[pairings] subscription', err),
    )
    return () => { unsubDevices(); unsubRequests() }
  }, [patientUid])

  const fail = (title: string, err: unknown) => {
    console.error(title, err)
    toast.show(title, isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
  }

  const decide = async (p: Pairing, approve: boolean) => {
    setBusy(true)
    try {
      await approvePairing(p.id, approve)
      toast.show(approve ? tr('연결을 승인했어요', 'The link is approved') : tr('연결을 거절했어요', 'The request was turned down'))
    } catch (err) {
      fail(tr('처리하지 못했어요', "Couldn't do that"), err)
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (d: ElderDevice) => {
    setBusy(true)
    try {
      await unlinkDevice(patientUid, d.id)
      toast.show(tr('연결을 해제했어요', 'The phone is unlinked'), tr(`${d.name}에서 더 이상 기록할 수 없어요`, `${d.name} can't take photos any more`))
      setConfirmUnlink(null)
    } catch (err) {
      fail(tr('해제하지 못했어요', "Couldn't unlink it"), err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sect">
      <SectLab info={tr('휴대폰을 잃어버렸다면 바로 ‘연결 해제’를 눌러주세요. 새 휴대폰을 원격으로 연결할 때는 여기서 승인해야 연결돼요.', 'If the phone is lost, tap Unlink right away. When a new phone is linked from afar, you approve it here.')}>{tr(`${honorific(patientName)} 휴대폰`, `${honorific(patientName)}'s phone`)}</SectLab>

      {requests.map((p) => (
        <div className="row approval-row" key={p.id}>
          <div className="who">
            <b>{tr('새 휴대폰 연결 요청', 'A new phone wants to link')}</b><br />
            <span>{p.deviceInfo?.name ?? tr('휴대폰', 'Phone')} · {tr('직접 보낸 링크가 맞을 때만 승인하세요', 'Approve it only if this is the link you sent')}</span>
          </div>
          <div className="send-row">
            <button className="signin-secondary" disabled={busy} onClick={() => decide(p, false)}>{tr('거절', 'Turn down')}</button>
            <button className="linkbtn" disabled={busy} onClick={() => decide(p, true)}><span>{tr('승인', 'Approve')}</span></button>
          </div>
        </div>
      ))}

      {devices.length === 0 ? (
        <div className="row"><div className="who"><span>{tr('아직 연결된 휴대폰이 없어요.', 'No phone is linked yet.')}</span></div></div>
      ) : devices.map((d) => (
        <div className="row" key={d.id}>
          <div className="who">
            <b>{d.name}</b><br />
            <span>{d.pairedAt ? tr(`${d.pairedAt.toDate().toLocaleDateString('ko-KR')} 연결`, `Linked ${d.pairedAt.toDate().toLocaleDateString('en-US')}`) : tr('연결됨', 'Linked')}</span>
          </div>
          <button className="signout-btn" onClick={() => setConfirmUnlink(d)}>{tr('연결 해제', 'Unlink')}</button>
        </div>
      ))}
      {devices.length > 0 && <ParentAppStatus patientUid={patientUid} patientName={patientName} canManage />}

      <button className="linkbtn" onClick={() => setSending(true)} style={{ marginTop: 8 }}>
        <span>{devices.length === 0 ? tr('휴대폰 연결 링크 보내기', 'Send a link to the phone') : tr('새 휴대폰 연결', 'Link a new phone')}</span>
        <span aria-hidden="true">→</span>
      </button>

      {sending && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <PairingSender patientUid={patientUid} patientName={patientName} onClose={() => setSending(false)} />
          </div>
        </div>
      )}

      {confirmUnlink && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">{tr('연결을 해제할까요?', 'Unlink this phone?')}</div>
            <div className="modal-body">
              <p>{tr(`${confirmUnlink.name}에서 ${honorific(patientName)} 기록을 더 이상 보거나 찍을 수 없어요. 다시 쓰려면 새 연결 링크를 보내야 해요.`, `${confirmUnlink.name} can no longer see or take ${honorific(patientName)}'s photos. To use it again, send a new link.`)}</p>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" onClick={() => setConfirmUnlink(null)}>{tr('취소', 'Cancel')}</button>
              <button className="linkbtn" disabled={busy} onClick={() => unlink(confirmUnlink)}>
                <span>{busy ? tr('해제하는 중…', 'Unlinking…') : tr('연결 해제', 'Unlink')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
