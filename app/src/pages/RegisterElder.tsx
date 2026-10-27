import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { isWorkerOffline, WorkerError, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { canShareRemotely, createManagedElder, createPairingLink, deleteManagedElder, formatPairCode, type PairingLink } from '../lib/pairing'
import { isSimple } from '../lib/edition'
import { simpleGuardianConsent } from '../lib/consent'
import { nameTaken } from '../lib/people'
import { buildPairMessage, copyPairMessage, openSMS, sharePairToKakao } from '../lib/share'
import { deviceGeoLang } from '../util'
import { tr } from '../lib/lang'
import type { UserSettings } from '../types'

/**
 * 부모님 등록하기 — the family sets up everything so the elder only has to tap
 * one link: name → settings → consent on the parent's behalf → send the
 * phone-linking link (KakaoTalk / text message / QR in person).
 *
 * Simple edition (엄마 연결하기): name → consent → the QR right away, with
 * 카카오톡으로 보내기 for a parent who isn't nearby. Phone settings keep their
 * defaults.
 */

const NAME_CHOICES = [
  tr('엄마', 'Mom'), tr('아빠', 'Dad'), tr('어머니', 'Mother'),
  tr('아버지', 'Father'), tr('할머니', 'Grandma'), tr('할아버지', 'Grandpa'),
]

type Step = 'name' | 'settings' | 'consent' | 'send'

const simple = isSimple()
const TITLE = simple ? tr('엄마 연결하기', "Link Mom's phone") : tr('부모님 등록하기', 'Register a parent')
const TOTAL = simple ? 2 : 3

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
  const [settings, setSettings] = useState<Pick<UserSettings, 'cadence' | 'autoMode' | 'bigText' | 'geoLang'>>({
    cadence: 'daily', autoMode: true, bigText: true, geoLang: deviceGeoLang(),
  })
  const [busy, setBusy] = useState(false)
  const [patientUid, setPatientUid] = useState<string | null>(null)
  // The QR link made in the same call as the parent (simple edition).
  const [firstLink, setFirstLink] = useState<PairingLink | null>(null)

  const register = async () => {
    setBusy(true)
    try {
      const res = await createManagedElder({ patientName: name.trim(), settings, ...(simple ? { link: 'qr' as const } : {}) })
      if (res.link) setFirstLink(res.link)
      setPatientUid(res.patientUid)
      setStep('send')
    } catch (err) {
      console.error('[register] failed', err)
      if (err instanceof WorkerError && err.code === 'already-exists') {
        // The worker's own check (this screen's list can be a moment behind).
        toast.show(tr('이미 같은 이름으로 등록되어 있어요', 'Someone is already registered under that name'), tr('다른 이름으로 등록해 주세요', 'Please use a different name'))
        setStep('name')
      } else {
        toast.show(tr('등록하지 못했어요', "Couldn't register"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
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
    toast.show(tr('등록을 취소했어요', 'Registration cancelled'), tr(`${name.trim()}님은 등록되지 않았어요`, `${name.trim()} was not registered`))
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
            <div className="modal-title">{TITLE} <span className="step-no">1/{TOTAL}</span></div>
            <div className="modal-body">
              <p>{tr('부모님을 어떻게 부르시나요? 가족 알림에 이 이름이 보여요.', 'What do you call your parent? Family alerts show this name.')}</p>
              <div className="name-chips">
                {NAME_CHOICES.map((n) => (
                  <button key={n} className={`name-chip ${name === n ? 'on' : ''}`} onClick={() => setName(n)}>{n}</button>
                ))}
              </div>
              <input
                className="text-input"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 20))}
                placeholder={tr('직접 입력', 'Type a name')}
                aria-label={tr('부모님 이름', "Parent's name")}
              />
              {clash && (
                <div className="name-clash" role="alert">
                  <b>{tr(`이미 ‘${clash}’님이 등록되어 있어요.`, `‘${clash}’ is already registered.`)}</b>
                  <span>{tr(
                    `다른 분이라면 구분되는 이름으로 등록해 주세요 (예: 외${clash}). 같은 분의 새 휴대폰을 연결하려면 ${clash}님 설정의 ‘기기 관리’에서 ‘새 휴대폰 연결’을 눌러 주세요.`,
                    `If this is someone else, use a name that tells them apart. To connect a new phone for the same person, open ${clash}'s settings and tap ‘Link a new phone’.`,
                  )}</span>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" onClick={onClose}>{tr('취소', 'Cancel')}</button>
              <button className="linkbtn" disabled={!name.trim() || !!clash} onClick={() => setStep(simple ? 'consent' : 'settings')}>
                <span>{tr('다음', 'Next')}</span><span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {step === 'settings' && (
          <>
            <div className="modal-title">{tr(`${name.trim()}님 휴대폰 설정`, `${name.trim()}'s phone`)} <span className="step-no">2/3</span></div>
            <div className="modal-body">
              <div className="sect-lab">{tr('글자 크기', 'Text size')}</div>
              <div className="seg">
                <button className={settings.bigText ? 'on' : ''} onClick={() => setSettings({ ...settings, bigText: true })}>{tr('크게', 'Large')}</button>
                <button className={!settings.bigText ? 'on' : ''} onClick={() => setSettings({ ...settings, bigText: false })}>{tr('보통', 'Normal')}</button>
              </div>
              <div className="sect-lab">{tr('가족에게 보내는 시점', 'When family hears about it')}</div>
              <div className="seg">
                <button className={settings.cadence === 'realtime' ? 'on' : ''} onClick={() => setSettings({ ...settings, cadence: 'realtime' })}>{tr('실시간', 'Right away')}</button>
                <button className={settings.cadence === 'daily' ? 'on' : ''} onClick={() => setSettings({ ...settings, cadence: 'daily' })}>{tr('매일 저녁', 'Every evening')}</button>
                <button className={settings.cadence === 'weekly' ? 'on' : ''} onClick={() => setSettings({ ...settings, cadence: 'weekly' })}>{tr('매주', 'Weekly')}</button>
              </div>
              <div className="sect-lab">{tr('자동 기록', 'Automatic memos')}</div>
              <div className="seg">
                <button className={settings.autoMode ? 'on' : ''} onClick={() => setSettings({ ...settings, autoMode: true })}>{tr('켜기', 'On')}</button>
                <button className={!settings.autoMode ? 'on' : ''} onClick={() => setSettings({ ...settings, autoMode: false })}>{tr('끄기', 'Off')}</button>
              </div>
              <div className="help">{tr('나중에 설정에서 언제든 바꿀 수 있어요.', 'You can change all of this later in Settings.')}</div>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" onClick={() => setStep('name')}>{tr('이전', 'Back')}</button>
              <button className="linkbtn" onClick={() => setStep('consent')}>
                <span>{tr('다음', 'Next')}</span><span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {step === 'consent' && (
          <>
            <div className="modal-title">{tr('부모님을 대신해 동의', 'Consent on your parent’s behalf')} <span className="step-no">{TOTAL}/{TOTAL}</span></div>
            <div className="modal-body">
              <p>{tr(`${name.trim()}님을 대신해 아래 내용에 동의합니다.`, `On behalf of ${name.trim()}, I agree to the following.`)}</p>
              {simple ? (
                <ul className="consent-list">
                  {simpleGuardianConsent(name.trim()).map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : (
                <ul className="consent-list">
                  <li>{tr(`${name.trim()}님이 찍은 사진과 자동으로 작성된 메모(시간·장소)를 저장하고 처리해요.`, `The photos ${name.trim()} takes, and the memos written for them (time and place), are stored and processed.`)}</li>
                  <li>{tr('그 사진·메모·위치를 초대된 가족에게 보여줘요.', 'Those photos, memos and places are shown to invited family members.')}</li>
                  <li>{tr(`${name.trim()}님이 가족에게 남기는 음성 답장(녹음과 받아쓴 글)을 저장하고 가족에게 들려줘요.`, `The voice replies ${name.trim()} leaves for family (the recording and its text) are stored and played back to them.`)}</li>
                </ul>
              )}
              <div className="help">
                {tr(`동의는 기록으로 남아요. ${name.trim()}님 휴대폰을 처음 연결할 때 본인에게도 한 번 안내해요.`, `This consent is kept on record. ${name.trim()} is told about it once too, when their phone is first connected.`)}
              </div>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" onClick={() => setStep(simple ? 'name' : 'settings')}>{tr('이전', 'Back')}</button>
              <button className="linkbtn" disabled={busy} onClick={register}>
                <span>{busy
                  ? (simple
                      ? tr(`${name.trim()}님 연결을 준비하고 있어요…`, `Getting ${name.trim()}'s link ready…`)
                      : tr('등록하는 중…', 'Registering…'))
                  : tr('동의하고 등록하기', 'Agree and register')}</span><span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {step === 'send' && patientUid && (
          <PairingSender patientUid={patientUid} patientName={name.trim()} initialLink={firstLink} onClose={close} onCancelRegistration={cancelRegistration} />
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
export function PairingSender({ patientUid, patientName, initialLink = null, onClose, onCancelRegistration }: {
  patientUid: string
  patientName: string
  /** A QR link made together with the parent: shown at once, no second call. */
  initialLink?: PairingLink | null
  onClose: () => void
  /** Only right after registering: undo the registration instead of finishing. */
  onCancelRegistration?: () => Promise<void>
}) {
  const toast = useToast()
  const [link, setLink] = useState<(PairingLink & { mode: 'remote' | 'qr' }) | null>(initialLink ? { ...initialLink, mode: 'qr' } : null)
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
      toast.show(tr('연결 링크를 만들지 못했어요', "Couldn't make the link"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
      return null
    } finally {
      setBusy(false)
    }
  }

  const hours = (l: PairingLink) => (l.purpose === 'onboard' ? 24 : 1)
  const message = (l: PairingLink) => buildPairMessage(patientName, l.url, l.code, hours(l))

  const onKakao = async () => {
    setShowPhone(false)
    // Simple: the QR on screen usually onboards, so the same link can go out.
    const l = simple && link && canShareRemotely(link) ? link : await ensureLink('remote')
    if (!l) return
    try {
      if ((await sharePairToKakao(message(l), l.url)) === 'copied') {
        toast.show(tr('메시지를 복사했어요', 'Message copied'), tr('카카오톡에 붙여넣어 보내주세요', 'Paste it into a message and send it'))
      }
    } catch (err) {
      console.error('[pair] kakao failed', err)
      toast.show(tr('카카오톡을 열 수 없어요', "Couldn't open the share sheet"), tr('문자로 보내주세요', 'Please send it by text message'))
    }
  }

  const onCopy = async () => {
    setShowPhone(false)
    const l = simple && link && canShareRemotely(link) ? link : await ensureLink('remote')
    if (!l) return
    try {
      await copyPairMessage(message(l))
      toast.show(tr('링크를 복사했어요', 'Link copied'), tr('문자나 메신저에 붙여넣어 보내주세요', 'Paste it into a text or a message and send it'))
    } catch (err) {
      console.error('[pair] copy failed', err)
      toast.show(tr('복사하지 못했어요', "Couldn't copy it"), tr('카카오톡으로 보내주세요', 'Please send the link instead'))
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

  // Simple edition: the QR is the main way, so it's made straight away.
  const qrAsked = useRef(false)
  useEffect(() => {
    if (!simple || qrAsked.current || initialLink) return
    qrAsked.current = true
    void Promise.resolve().then(() => ensureLink('qr'))
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (link?.mode !== 'qr') { setQr(''); return }
    // The QR maker loads only when a QR is shown.
    import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(link.url, { width: 260, margin: 1 })).then(setQr).catch(() => setQr(''))
  }, [link])

  return (
    <>
      <div className="modal-title">{tr(`${patientName}님 휴대폰 연결`, `Connect ${patientName}'s phone`)}</div>
      <div className="modal-body">
        {simple ? (
          <p>{tr(`${patientName}님 휴대폰에서 Daylie 앱을 열고 이 QR을 비춰주세요. 떨어져 계시면 카카오톡으로 보내거나 링크를 복사해 보내주세요.`, `Open the Daylie app on ${patientName}'s phone and hold it up to this QR. If they aren't with you, send the link or copy it and send it yourself.`)}</p>
        ) : (
          <p>{tr(`${patientName}님 휴대폰으로 연결 링크를 보내주세요. 받은 링크를 누르고 ‘연결하기’만 누르면 끝나요.`, `Send the link to ${patientName}'s phone. They tap the link, then tap ‘Connect’, and that's it.`)}</p>
        )}
        <div className="invite-send">
          <button className="invite-btn invite-kakao" disabled={busy} onClick={onKakao}>{tr('카카오톡으로 보내기', 'Send the link')}</button>
          <button className="invite-btn invite-copy" disabled={busy} onClick={onCopy}>{tr('링크 복사하기', 'Copy the link')}</button>
          {simple ? null : showPhone ? (
            <div className="invite-phone">
              <label htmlFor="pair-phone">{tr(`${patientName}님 전화번호`, `${patientName}'s phone number`)}</label>
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
              <button className="invite-btn invite-sms" disabled={busy || phoneDigits.length < 9} onClick={onSms}>{tr('문자 보내기', 'Send the text')}</button>
            </div>
          ) : (
            <button className="invite-btn invite-sms" disabled={busy} onClick={() => setShowPhone(true)}>{tr('문자로 보내기', 'Send by text')}</button>
          )}
          {(!simple || link?.mode !== 'qr') && (
            <button className="invite-btn invite-qr" disabled={busy} onClick={onQr}>{tr('옆에 계시면 QR 보여주기', 'Show a QR if they are with you')}</button>
          )}
        </div>

        {simple && !link && busy && (
          <div className="pair-qr"><div className="help" style={{ textAlign: 'center' }}>{tr('QR을 만들고 있어요…', 'Making the QR…')}</div></div>
        )}

        {link?.mode === 'qr' && (
          <div className="pair-qr">
            {qr && <img src={qr} alt={tr('휴대폰 연결 QR 코드', 'Phone connection QR code')} width={220} height={220} />}
            <div className="help" style={{ textAlign: 'center' }}>
              {tr(`${patientName}님 휴대폰 카메라로 이 QR을 비춰주세요.`, `Point the camera on ${patientName}'s phone at this QR.`)}
            </div>
          </div>
        )}

        {link && (
          <div className="pair-code-box">
            <div className="help">{tr('앱에서 직접 넣을 때 코드', 'Code to type into the app')}</div>
            <div className="invite-code-display">{formatPairCode(link.code)}</div>
            <div className="help">
              {tr(`${hours(link)}시간 동안 한 번만 쓸 수 있어요.`, `Good for one use within ${hours(link)} hour${hours(link) === 1 ? '' : 's'}.`)}
              {link.purpose === 'repair' && link.mode === 'remote' && tr(' 연결 요청이 오면 여기서 승인해야 연결돼요.', ' When the request arrives, approve it here to finish connecting.')}
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
              if (!confirm(tr(`${patientName}님 등록을 취소할까요?\n방금 만든 ${patientName}님 계정과 연결 링크가 지워져요.`, `Cancel ${patientName}'s registration?\nThe account you just made for ${patientName} and the link will be deleted.`))) return
              setBusy(true)
              try {
                await onCancelRegistration()
              } catch (err) {
                console.error('[register] cancel failed', err)
                toast.show(tr('취소하지 못했어요', "Couldn't cancel"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('설정 아래쪽 ‘부모님 삭제’에서 지울 수 있어요', 'You can remove them at the bottom of Settings'))
                setBusy(false)
              }
            }}
          >{tr('등록 취소', 'Cancel registration')}</button>
        )}
        <button className="signin-secondary" disabled={busy} onClick={onClose}>{tr('완료', 'Done')}</button>
      </div>
    </>
  )
}
