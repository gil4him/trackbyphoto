import { useEffect, useRef, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../firebase'
import { signInAsElder, signInForPairing } from '../hooks/useAuth'
import { useMemberships } from '../hooks/useMemberships'
import { isSimple } from '../lib/edition'
import { sentToName } from '../lib/people'
import { SIMPLE_CONSENT_VERSION, simpleConsentText } from '../lib/consent'
import { SimpleConsent } from '../components/SimpleConsent'
import { WorkerError, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import {
  afterConnect,
  currentInstallPath,
  externalBrowserUrl,
  keepThisPageForHomeScreen,
  pairStart,
  promptInstall,
} from '../lib/install'
import {
  completePairing,
  MANAGED_CONSENT_VERSION,
  normalizePairCode,
  pairDevice,
  PAIR_CODE_LEN,
  type PairResult,
} from '../lib/pairing'

/**
 * The elder's whole onboarding: one big 연결하기 button (the code arrives in
 * the link), then one 확인 on a plain-language notice. When the app is opened
 * without a link, the elder (or whoever is helping) types the 8-character
 * code from the family's message instead.
 *
 * The parent should also end up with an icon on the home screen, so the
 * link flow includes putting it there, as far as each phone allows (see
 * lib/install.ts): in KakaoTalk's built-in browser the link is first handed
 * to the phone's real browser, on Android the browser's own install dialog
 * follows 확인, and on an iPhone the icon is added first and the connection
 * is finished from it. None of this touches the code: it is still used once,
 * by the phone that ends up connected.
 */

type Step =
  | 'open-browser' | 'add-ios'
  | 'confirm' | 'enter' | 'family-warning' | 'connecting' | 'waiting' | 'notice'
  | 'installed' | 'install-manual'
  | 'error'

const NOTICE_TEXT = '가족이 내 사진과 기록(시간·장소)을 함께 볼 수 있어요.'

function errorMessage(err: unknown): string {
  const code = err instanceof WorkerError ? err.code : ''
  switch (code) {
    case 'unavailable': return WORKER_OFFLINE_MESSAGE
    case 'not-found':
    case 'invalid-argument': return '코드가 맞지 않아요. 가족이 보낸 코드를 다시 확인해 주세요.'
    case 'failed-precondition': return '이미 사용된 코드예요. 가족에게 새 연결을 요청해 주세요.'
    case 'deadline-exceeded': return '코드 사용 기간이 지났어요. 가족에게 새 연결을 요청해 주세요.'
    case 'resource-exhausted': return '시도가 너무 많았어요. 10분 뒤에 다시 해 주세요.'
    case 'permission-denied': return '연결이 거절되었어요. 가족에게 문의해 주세요.'
    default: return '연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
  }
}

export function PairDevice({ initialCode, alreadyLinked = false, autoConnect = false, onDone, onCancel }: {
  initialCode: string
  /** This phone is already connected as a parent's phone. */
  alreadyLinked?: boolean
  /** Connect straight away instead of asking 연결하기 first — the code was
   *  just scanned from the family's QR (simple edition, ElderPairStart). */
  autoConnect?: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const [code, setCode] = useState(normalizePairCode(initialCode))
  // An iPhone's home-screen icon keeps the link it was added from, so it
  // opens here every time: once connected, go straight on to the app.
  const [linkedAtOpen] = useState(alreadyLinked)
  useEffect(() => {
    if (linkedAtOpen) onDone()
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [step, setStep] = useState<Step>(() => {
    const u = auth.currentUser
    return pairStart({
      familySignedIn: !!u && !u.isAnonymous,
      hasCode: normalizePairCode(initialCode).length === PAIR_CODE_LEN,
      path: currentInstallPath(),
    })
  })
  const externalUrl = step === 'open-browser' ? externalBrowserUrl(window.location.href, navigator.userAgent) : null
  useEffect(() => {
    if (step === 'add-ios') keepThisPageForHomeScreen()
  }, [step])
  const [error, setError] = useState('')
  const [pairingId, setPairingId] = useState<string | null>(null)
  // The parent's uid once connected: the simple edition's 확인 names the
  // family member who will see the photos.
  const [elderUid, setElderUid] = useState<string | undefined>()
  const { caregivers } = useMemberships(isSimple() ? elderUid : undefined, { withPatients: false })

  const finish = async (res: PairResult) => {
    if (res.status === 'awaiting-approval') {
      setPairingId(res.pairingId)
      setStep('waiting')
      return
    }
    await signInAsElder(res.customToken)
    setElderUid(auth.currentUser?.uid)
    setStep('notice')
  }

  const connect = async () => {
    setStep('connecting')
    setError('')
    try {
      await signInForPairing()
      await finish(await pairDevice(code))
    } catch (err) {
      console.error('[pair] failed', err)
      setError(errorMessage(err))
      setStep('error')
    }
  }

  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoConnect || autoStarted.current || linkedAtOpen) return
    if (step !== 'confirm' || code.length !== PAIR_CODE_LEN) return
    autoStarted.current = true
    void Promise.resolve().then(connect)
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Waiting for family approval of a re-link: watch the pairing, then collect
  // the token the moment it is approved.
  useEffect(() => {
    if (step !== 'waiting' || !pairingId) return
    const unsub = onSnapshot(doc(db, 'pairings', pairingId), async (snap) => {
      const status = snap.data()?.status
      if (status === 'approved') {
        unsub()
        setStep('connecting')
        try {
          await finish(await completePairing(pairingId))
        } catch (err) {
          setError(errorMessage(err))
          setStep('error')
        }
      } else if (status === 'denied' || status === 'expired') {
        unsub()
        setError(status === 'denied' ? '가족이 연결을 거절했어요.' : '요청 시간이 지났어요. 가족에게 새 연결을 요청해 주세요.')
        setStep('error')
      }
    }, (err) => console.warn('[pair] watch failed', err))
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pairingId])

  // One 네 is enough: a second tap mustn't write a second record.
  const [acking, setAcking] = useState(false)
  const acknowledge = async () => {
    if (acking) return
    setAcking(true)
    // The install dialog must be asked for straight from the tap, so it goes
    // first; the acknowledgement is written while the dialog is up.
    const next = afterConnect(currentInstallPath())
    const installing = next === 'prompt' ? promptInstall().catch(() => false) : null
    const uid = auth.currentUser?.uid
    if (uid) {
      // The elder's own one-tap acknowledgement, kept next to the family's
      // consent as PIPA evidence. Failure must not block the elder.
      await addDoc(collection(db, 'consents'), {
        patientUid: uid,
        type: 'notice_ack',
        grantedBy: 'self',
        guardianUid: null,
        // Simple: the exact sentence the parent said 네 to (SimpleConsent).
        scope: isSimple() ? simpleConsentText(sentToName(caregivers)) : NOTICE_TEXT,
        consentTextVersion: isSimple() ? SIMPLE_CONSENT_VERSION : MANAGED_CONSENT_VERSION,
        timestamp: serverTimestamp(),
      }).catch((e) => console.warn('[pair] notice ack failed', e))
    }
    if (installing) {
      if (await installing) setStep('installed')
      else onDone()
    } else if (next === 'manual') {
      setStep('install-manual')
    } else {
      onDone()
    }
  }

  const cancel = async () => {
    if (auth.currentUser?.isAnonymous) await signOut(auth).catch(() => {})
    onCancel()
  }

  if (linkedAtOpen) return null

  return (
    <section className="pair">
      <div className="signin-dot" />
      {step === 'open-browser' && (
        <>
          <h1 className="pair-title">인터넷 앱에서<br />열어 주세요</h1>
          {externalUrl ? (
            <>
              <p className="pair-sub">아래 버튼을 누르면 인터넷 앱으로 넘어가요. 거기서 연결하면 홈 화면에 오늘하루 아이콘을 만들 수 있어요.</p>
              <a className="pair-btn" href={externalUrl}>계속하기</a>
            </>
          ) : (
            <ol className="pair-steps">
              <li>화면 아래(또는 위)의 ⋯ 또는 공유 버튼을 눌러요.</li>
              <li>“Safari로 열기” 또는 “다른 브라우저로 열기”를 눌러요.</li>
              <li>열린 화면에서 연결을 계속해요.</li>
            </ol>
          )}
          <button className="pair-link" onClick={() => setStep('confirm')}>아이콘 없이 여기서 연결하기</button>
        </>
      )}

      {step === 'add-ios' && (
        <>
          <h1 className="pair-title">먼저 홈 화면에<br />추가해 주세요</h1>
          <ol className="pair-steps">
            <li>아래쪽의 공유 버튼(네모에서 화살표가 올라가는 모양)을 눌러요.</li>
            <li>목록을 내려 “홈 화면에 추가”를 눌러요.</li>
            <li>오른쪽 위 “추가”를 눌러요.</li>
            <li>홈 화면에 생긴 <b>오늘하루</b> 아이콘을 누르면 연결이 이어져요.</li>
          </ol>
          <button className="pair-link" onClick={() => setStep('confirm')}>아이콘 없이 여기서 연결하기</button>
        </>
      )}

      {step === 'confirm' && (
        <>
          <h1 className="pair-title">휴대폰을 가족과<br />연결할까요?</h1>
          <p className="pair-sub">아래 버튼을 한 번 눌러주세요.</p>
          <button className="pair-btn" onClick={connect}>연결하기</button>
          <button className="signin-secondary" onClick={cancel}>나중에</button>
        </>
      )}

      {step === 'enter' && (
        <>
          <h1 className="pair-title">가족에게 받은<br />코드를 넣어주세요</h1>
          <input
            className="pair-code-input"
            value={code}
            onChange={(e) => setCode(normalizePairCode(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter' && code.length === PAIR_CODE_LEN) connect() }}
            placeholder="ABCD1234"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            aria-label="연결 코드"
            autoFocus
          />
          <button className="pair-btn" onClick={connect} disabled={code.length !== PAIR_CODE_LEN}>연결하기</button>
          <button className="signin-secondary" onClick={cancel}>돌아가기</button>
        </>
      )}

      {step === 'family-warning' && (
        <>
          <h1 className="pair-title">부모님 휴대폰에서<br />열어주세요</h1>
          <p className="pair-sub">
            지금 이 휴대폰은 가족 계정({auth.currentUser?.email})으로 로그인되어 있어요.
            이 링크는 부모님 휴대폰을 연결하는 링크예요.
          </p>
          <button className="signin-secondary" onClick={onCancel}>취소</button>
          <button
            className="pair-link"
            onClick={async () => {
              await signOut(auth).catch(() => {})
              setStep(code.length === PAIR_CODE_LEN ? 'confirm' : 'enter')
            }}
          >이 휴대폰을 부모님 휴대폰으로 연결하기</button>
        </>
      )}

      {step === 'connecting' && (
        <>
          <h1 className="pair-title">연결하는 중이에요…</h1>
          <p className="pair-sub">잠시만 기다려 주세요.</p>
        </>
      )}

      {step === 'waiting' && (
        <>
          <h1 className="pair-title">가족의 승인을<br />기다리고 있어요</h1>
          <p className="pair-sub">가족 휴대폰에 승인 요청을 보냈어요. 이 화면을 켜 두세요.</p>
          <button className="signin-secondary" onClick={cancel}>취소</button>
        </>
      )}

      {step === 'notice' && isSimple() && (
        <SimpleConsent caregivers={caregivers} busy={acking} onAccept={() => void acknowledge()} />
      )}

      {step === 'notice' && !isSimple() && (
        <>
          <h1 className="pair-title">연결되었어요</h1>
          <p className="pair-notice">{NOTICE_TEXT}</p>
          <button className="pair-btn" onClick={acknowledge}>확인</button>
        </>
      )}

      {step === 'installed' && (
        <>
          <h1 className="pair-title">홈 화면에<br />아이콘이 생겨요</h1>
          <p className="pair-notice">다음부터는 홈 화면의 오늘하루 아이콘을 눌러 주세요.</p>
          <button className="pair-btn" onClick={onDone}>확인</button>
        </>
      )}

      {step === 'install-manual' && (
        <>
          <h1 className="pair-title">홈 화면에<br />아이콘을 만들어요</h1>
          <ol className="pair-steps">
            <li>화면 오른쪽 위(또는 아래)의 ⋮ 메뉴를 눌러요.</li>
            <li>“홈 화면에 추가” 또는 “앱 설치”를 눌러요.</li>
            <li>다음부터는 홈 화면의 <b>오늘하루</b> 아이콘을 눌러 주세요.</li>
          </ol>
          <button className="pair-btn" onClick={onDone}>확인</button>
        </>
      )}

      {step === 'error' && (
        <>
          <h1 className="pair-title">연결하지 못했어요</h1>
          <p className="pair-sub">{error}</p>
          <button className="pair-btn" onClick={() => setStep(code.length === PAIR_CODE_LEN ? 'confirm' : 'enter')}>다시 시도</button>
          <button className="signin-secondary" onClick={() => { setCode(''); setStep('enter') }}>코드 직접 입력</button>
        </>
      )}
    </section>
  )
}
