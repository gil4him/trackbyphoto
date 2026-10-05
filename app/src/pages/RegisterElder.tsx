import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useToast } from '../components/Toast'
import { isWorkerOffline, WorkerError, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { createManagedElder, createPairingLink, deleteManagedElder, formatPairCode, type PairingLink } from '../lib/pairing'
import { nameTaken } from '../lib/people'
import { buildPairMessage, openSMS, sharePairToKakao } from '../lib/share'
import type { UserSettings } from '../types'

/**
 * 부모님 등록하기 — the family sets up everything so the elder only has to tap
 * one link: name → settings → consent on the parent's behalf → send the
 * phone-linking link (KakaoTalk / text message / QR in person).
 */

const NAME_CHOICES = ['엄마', '아빠', '어머니', '아버지', '할머니', '할아버지']

type Step = 'name' | 'settings' | 'consent' | 'send'

export function RegisterElder({ onClose, onRegistered, takenNames = [] }: {
  /** Names of the people this family member already looks after: a second
   *  person under the same name couldn't be told apart anywhere. */
  takenNames?: string[]
  onClose: () => void
  /** Called once the elder exists, so the app can switch to their records. */
  onRegistered: (patientUid: string) => void
}) {
  const toast = useToast()
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [settings, setSettings] = useState<Pick<UserSettings, 'cadence' | 'autoMode' | 'bigText'>>({
    cadence: 'daily', autoMode: true, bigText: true,
  })
  const [busy, setBusy] = useState(false)
  const [patientUid, setPatientUid] = useState<string | null>(null)

  const register = async () => {
    setBusy(true)
    try {
      const res = await createManagedElder({ patientName: name.trim(), settings })
      setPatientUid(res.patientUid)
      setStep('send')
    } catch (err) {
      console.error('[register] failed', err)
      if (err instanceof WorkerError && err.code === 'already-exists') {
        // The worker's own check (this screen's list can be a moment behind).
        toast.show('이미 같은 이름으로 등록되어 있어요', '다른 이름으로 등록해 주세요')
        setStep('name')
      } else {
        toast.show('등록하지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
      }
    } finally {
      setBusy(false)
    }
  }

  // 등록 취소 on the link step: the parent was created a moment ago (the link
  // needs someone to belong to); take them out again, with everything of theirs.
  const cancelRegistration = async () => {
    if (!patientUid) return
    await deleteManagedElder(patientUid)
    toast.show('등록을 취소했어요', `${name.trim()}님은 등록되지 않았어요`)
    onClose()
  }
  const clash = nameTaken(name, takenNames)

  const close = () => {
    if (patientUid) onRegistered(patientUid)
    onClose()
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        {step === 'name' && (
          <>
            <div className="modal-title">부모님 등록하기 <span className="step-no">1/3</span></div>
            <div className="modal-body">
              <p>부모님을 어떻게 부르시나요? 가족 알림에 이 이름이 보여요.</p>
              <div className="name-chips">
                {NAME_CHOICES.map((n) => (
                  <button key={n} className={`name-chip ${name === n ? 'on' : ''}`} onClick={() => setName(n)}>{n}</button>
                ))}
              </div>
              <input
                className="text-input"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 20))}
                placeholder="직접 입력"
                aria-label="부모님 이름"
              />
              {clash && (
                <div className="name-clash" role="alert">
                  <b>이미 ‘{clash}’님이 등록되어 있어요.</b>
                  <span>다른 분이라면 구분되는 이름으로 등록해 주세요 (예: 외{clash}). 같은 분의 새 휴대폰을 연결하려면 {clash}님 설정의 ‘기기 관리’에서 ‘새 휴대폰 연결’을 눌러 주세요.</span>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" onClick={onClose}>취소</button>
              <button className="linkbtn" disabled={!name.trim() || !!clash} onClick={() => setStep('settings')}>
                <span>다음</span><span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {step === 'settings' && (
          <>
            <div className="modal-title">{name.trim()}님 휴대폰 설정 <span className="step-no">2/3</span></div>
            <div className="modal-body">
              <div className="sect-lab">글자 크기</div>
              <div className="seg">
                <button className={settings.bigText ? 'on' : ''} onClick={() => setSettings({ ...settings, bigText: true })}>크게</button>
                <button className={!settings.bigText ? 'on' : ''} onClick={() => setSettings({ ...settings, bigText: false })}>보통</button>
              </div>
              <div className="sect-lab">가족에게 보내는 시점</div>
              <div className="seg">
                <button className={settings.cadence === 'realtime' ? 'on' : ''} onClick={() => setSettings({ ...settings, cadence: 'realtime' })}>실시간</button>
                <button className={settings.cadence === 'daily' ? 'on' : ''} onClick={() => setSettings({ ...settings, cadence: 'daily' })}>매일 저녁</button>
                <button className={settings.cadence === 'weekly' ? 'on' : ''} onClick={() => setSettings({ ...settings, cadence: 'weekly' })}>매주</button>
              </div>
              <div className="sect-lab">자동 기록</div>
              <div className="seg">
                <button className={settings.autoMode ? 'on' : ''} onClick={() => setSettings({ ...settings, autoMode: true })}>켜기</button>
                <button className={!settings.autoMode ? 'on' : ''} onClick={() => setSettings({ ...settings, autoMode: false })}>끄기</button>
              </div>
              <div className="help">나중에 설정에서 언제든 바꿀 수 있어요.</div>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" onClick={() => setStep('name')}>이전</button>
              <button className="linkbtn" onClick={() => setStep('consent')}>
                <span>다음</span><span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {step === 'consent' && (
          <>
            <div className="modal-title">부모님을 대신해 동의 <span className="step-no">3/3</span></div>
            <div className="modal-body">
              <p>{name.trim()}님을 대신해 아래 내용에 동의합니다.</p>
              <ul className="consent-list">
                <li>{name.trim()}님이 찍은 사진과 자동으로 작성된 메모(시간·장소)를 저장하고 처리해요.</li>
                <li>그 사진·메모·위치를 초대된 가족에게 보여줘요.</li>
                <li>{name.trim()}님이 가족에게 남기는 음성 답장(녹음과 받아쓴 글)을 저장하고 가족에게 들려줘요.</li>
              </ul>
              <div className="help">
                동의는 기록으로 남아요. {name.trim()}님 휴대폰을 처음 연결할 때 본인에게도 한 번 안내해요.
              </div>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" onClick={() => setStep('settings')}>이전</button>
              <button className="linkbtn" disabled={busy} onClick={register}>
                <span>{busy ? '등록하는 중…' : '동의하고 등록하기'}</span><span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {step === 'send' && patientUid && (
          <PairingSender patientUid={patientUid} patientName={name.trim()} onClose={close} onCancelRegistration={cancelRegistration} />
        )}
      </div>
    </div>
  )
}

/**
 * Send a phone-linking link: KakaoTalk or text message (remote), or a QR code
 * the elder scans while sitting next to you. Used right after registering
 * and again from 기기 관리 → 새 휴대폰 연결.
 */
export function PairingSender({ patientUid, patientName, onClose, onCancelRegistration }: {
  patientUid: string
  patientName: string
  onClose: () => void
  /** Only right after registering: undo the registration instead of finishing. */
  onCancelRegistration?: () => Promise<void>
}) {
  const toast = useToast()
  const [link, setLink] = useState<(PairingLink & { mode: 'remote' | 'qr' }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPhone, setShowPhone] = useState(false)
  const [phone, setPhone] = useState('')
  const [qr, setQr] = useState('')

  // One live link at a time (the worker cancels older ones), so reuse it
  // while the mode matches.
  const ensureLink = async (mode: 'remote' | 'qr') => {
    if (link && link.mode === mode) return link
    setBusy(true)
    try {
      const l = { ...(await createPairingLink(patientUid, mode)), mode }
      setLink(l)
      return l
    } catch (err) {
      console.error('[pair] link failed', err)
      toast.show('연결 링크를 만들지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
      return null
    } finally {
      setBusy(false)
    }
  }

  const hours = (l: PairingLink) => (l.purpose === 'onboard' ? 24 : 1)
  const message = (l: PairingLink) => buildPairMessage(patientName, l.url, l.code, hours(l))

  const onKakao = async () => {
    setShowPhone(false)
    const l = await ensureLink('remote')
    if (!l) return
    try {
      if ((await sharePairToKakao(message(l), l.url)) === 'copied') {
        toast.show('메시지를 복사했어요', '카카오톡에 붙여넣어 보내주세요')
      }
    } catch (err) {
      console.error('[pair] kakao failed', err)
      toast.show('카카오톡을 열 수 없어요', '문자로 보내주세요')
    }
  }

  const phoneDigits = phone.replace(/\D+/g, '')
  const onSms = async () => {
    if (phoneDigits.length < 9) return
    const l = await ensureLink('remote')
    if (l) openSMS(phone, message(l))
  }

  const onQr = async () => {
    setShowPhone(false)
    await ensureLink('qr')
  }

  useEffect(() => {
    if (link?.mode !== 'qr') { setQr(''); return }
    QRCode.toDataURL(link.url, { width: 260, margin: 1 }).then(setQr).catch(() => setQr(''))
  }, [link])

  return (
    <>
      <div className="modal-title">{patientName}님 휴대폰 연결</div>
      <div className="modal-body">
        <p>{patientName}님 휴대폰으로 연결 링크를 보내주세요. 받은 링크를 누르고 ‘연결하기’만 누르면 끝나요.</p>
        <div className="invite-send">
          <button className="invite-btn invite-kakao" disabled={busy} onClick={onKakao}>카카오톡으로 보내기</button>
          {showPhone ? (
            <div className="invite-phone">
              <label htmlFor="pair-phone">{patientName}님 전화번호</label>
              <input
                id="pair-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="010-1234-5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSms() }}
                autoFocus
              />
              <button className="invite-btn invite-sms" disabled={busy || phoneDigits.length < 9} onClick={onSms}>문자 보내기</button>
            </div>
          ) : (
            <button className="invite-btn invite-sms" disabled={busy} onClick={() => setShowPhone(true)}>문자로 보내기</button>
          )}
          <button className="invite-btn invite-qr" disabled={busy} onClick={onQr}>옆에 계시면 QR 보여주기</button>
        </div>

        {link?.mode === 'qr' && (
          <div className="pair-qr">
            {qr && <img src={qr} alt="휴대폰 연결 QR 코드" width={220} height={220} />}
            <div className="help" style={{ textAlign: 'center' }}>
              {patientName}님 휴대폰 카메라로 이 QR을 비춰주세요.
            </div>
          </div>
        )}

        {link && (
          <div className="pair-code-box">
            <div className="help">앱에서 직접 넣을 때 코드</div>
            <div className="invite-code-display">{formatPairCode(link.code)}</div>
            <div className="help">
              {hours(link)}시간 동안 한 번만 쓸 수 있어요.
              {link.purpose === 'repair' && link.mode === 'remote' && ' 연결 요청이 오면 여기서 승인해야 연결돼요.'}
            </div>
          </div>
        )}
      </div>
      <div className="modal-actions">
        {onCancelRegistration && (
          <button
            className="signin-secondary danger-text"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`${patientName}님 등록을 취소할까요?\n방금 만든 ${patientName}님 계정과 연결 링크가 지워져요.`)) return
              setBusy(true)
              try {
                await onCancelRegistration()
              } catch (err) {
                console.error('[register] cancel failed', err)
                toast.show('취소하지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '설정 아래쪽 ‘부모님 삭제’에서 지울 수 있어요')
                setBusy(false)
              }
            }}
          >등록 취소</button>
        )}
        <button className="signin-secondary" disabled={busy} onClick={onClose}>완료</button>
      </div>
    </>
  )
}
