import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import { isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { approvePairing, unlinkDevice } from '../lib/pairing'
import { PairingSender } from '../pages/RegisterElder'
import type { ElderDevice, Pairing } from '../types'

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
    toast.show(title, isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
  }

  const decide = async (p: Pairing, approve: boolean) => {
    setBusy(true)
    try {
      await approvePairing(p.id, approve)
      toast.show(approve ? '연결을 승인했어요' : '연결을 거절했어요')
    } catch (err) {
      fail('처리하지 못했어요', err)
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (d: ElderDevice) => {
    setBusy(true)
    try {
      await unlinkDevice(patientUid, d.id)
      toast.show('연결을 해제했어요', `${d.name}에서 더 이상 기록할 수 없어요`)
      setConfirmUnlink(null)
    } catch (err) {
      fail('해제하지 못했어요', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sect">
      <div className="sect-lab">{patientName}님 휴대폰</div>

      {requests.map((p) => (
        <div className="row approval-row" key={p.id}>
          <div className="who">
            <b>새 휴대폰 연결 요청</b><br />
            <span>{p.deviceInfo?.name ?? '휴대폰'} · 직접 보낸 링크가 맞을 때만 승인하세요</span>
          </div>
          <div className="send-row">
            <button className="signin-secondary" disabled={busy} onClick={() => decide(p, false)}>거절</button>
            <button className="linkbtn" disabled={busy} onClick={() => decide(p, true)}><span>승인</span></button>
          </div>
        </div>
      ))}

      {devices.length === 0 ? (
        <div className="row"><div className="who"><span>아직 연결된 휴대폰이 없어요.</span></div></div>
      ) : devices.map((d) => (
        <div className="row" key={d.id}>
          <div className="who">
            <b>{d.name}</b><br />
            <span>{d.pairedAt ? `${d.pairedAt.toDate().toLocaleDateString('ko-KR')} 연결` : '연결됨'}</span>
          </div>
          <button className="signout-btn" onClick={() => setConfirmUnlink(d)}>연결 해제</button>
        </div>
      ))}

      <button className="linkbtn" onClick={() => setSending(true)} style={{ marginTop: 8 }}>
        <span>{devices.length === 0 ? '휴대폰 연결 링크 보내기' : '새 휴대폰 연결'}</span>
        <span aria-hidden="true">→</span>
      </button>
      <div className="help">
        휴대폰을 잃어버렸다면 바로 ‘연결 해제’를 눌러주세요. 새 휴대폰을 원격으로 연결할 때는 여기서 승인해야 연결돼요.
      </div>

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
            <div className="modal-title">연결을 해제할까요?</div>
            <div className="modal-body">
              <p>{confirmUnlink.name}에서 {patientName}님 기록을 더 이상 보거나 찍을 수 없어요. 다시 쓰려면 새 연결 링크를 보내야 해요.</p>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" onClick={() => setConfirmUnlink(null)}>취소</button>
              <button className="linkbtn" disabled={busy} onClick={() => unlink(confirmUnlink)}>
                <span>{busy ? '해제하는 중…' : '연결 해제'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
