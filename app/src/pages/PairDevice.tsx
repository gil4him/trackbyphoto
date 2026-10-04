import { useEffect, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../firebase'
import { signInAsElder, signInForPairing } from '../hooks/useAuth'
import { WorkerError, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
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
 */

type Step = 'confirm' | 'enter' | 'family-warning' | 'connecting' | 'waiting' | 'notice' | 'error'

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

export function PairDevice({ initialCode, onDone, onCancel }: {
  initialCode: string
  onDone: () => void
  onCancel: () => void
}) {
  const [code, setCode] = useState(normalizePairCode(initialCode))
  const [step, setStep] = useState<Step>(() => {
    const u = auth.currentUser
    if (u && !u.isAnonymous) return 'family-warning'
    return normalizePairCode(initialCode).length === PAIR_CODE_LEN ? 'confirm' : 'enter'
  })
  const [error, setError] = useState('')
  const [pairingId, setPairingId] = useState<string | null>(null)

  const finish = async (res: PairResult) => {
    if (res.status === 'awaiting-approval') {
      setPairingId(res.pairingId)
      setStep('waiting')
      return
    }
    await signInAsElder(res.customToken)
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

  const acknowledge = async () => {
    const uid = auth.currentUser?.uid
    if (uid) {
      // The elder's own one-tap acknowledgement, kept next to the family's
      // consent as PIPA evidence. Failure must not block the elder.
      await addDoc(collection(db, 'consents'), {
        patientUid: uid,
        type: 'notice_ack',
        grantedBy: 'self',
        guardianUid: null,
        scope: NOTICE_TEXT,
        consentTextVersion: MANAGED_CONSENT_VERSION,
        timestamp: serverTimestamp(),
      }).catch((e) => console.warn('[pair] notice ack failed', e))
    }
    onDone()
  }

  const cancel = async () => {
    if (auth.currentUser?.isAnonymous) await signOut(auth).catch(() => {})
    onCancel()
  }

  return (
    <section className="pair">
      <div className="signin-dot" />
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

      {step === 'notice' && (
        <>
          <h1 className="pair-title">연결되었어요</h1>
          <p className="pair-notice">{NOTICE_TEXT}</p>
          <button className="pair-btn" onClick={acknowledge}>확인</button>
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
