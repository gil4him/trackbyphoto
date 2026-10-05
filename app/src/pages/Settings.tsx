import { useState } from 'react'
import type { User } from 'firebase/auth'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import type { DigestSettings, UserSettings, Memo } from '../types'
import { useToast } from '../components/Toast'
import { useMemberships } from '../hooks/useMemberships'
import { isWorkerOffline, WorkerError, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import {
  createInvite,
  revokeMembership,
  setMembershipRole,
  type InvitableRole,
} from '../lib/caregiver'
import { sendInviteSMS, shareInviteToKakao } from '../lib/share'
import { RegisterElder } from './RegisterElder'
import { ElderDevices } from '../components/ElderDevices'
import { deleteManagedElder } from '../lib/pairing'
import { getGeo } from '../lib/location'
import { DEFAULT_DIGEST, DIGEST_HOURS, saveDigestSettings } from '../lib/digest'
import type { PlanReason } from '../lib/plan'
import { S } from '../lib/strings'
import type { PlanTier } from '../types'

/** Version of the 음성 답장 consent text shown below. */
const VOICE_CONSENT_VERSION = 'voice-v1'

interface Props {
  settings: UserSettings
  onChange: (next: UserSettings) => void
  user: User
  onSignOut: () => Promise<void>
  memos: Memo[]
  /** The patient whose data is currently being viewed. May be the signed-in
   *  user (self path) or another patient the user is caregiving for. */
  activePatientUid: string
  /** True when activePatientUid === user.uid. Drives whether to show the
   *  가족 관리 section (only the patient can invite family to their own
   *  account). */
  isSelf: boolean
  /** Switch the app to a patient (after 부모님 등록하기). */
  onSwitchPatient: (patientUid: string) => void
  /** The signed-in user's role on activePatientUid when it isn't self. */
  myRole?: string
  /** Voice replies are rolled out (admin_config/plans flag). */
  voiceRollout?: boolean
  /** Hearts and replies are rolled out: show how this person may answer in writing. */
  reactionsRollout?: boolean
  /** The digest is rolled out: 하루 요약 replaces the old 전송 시점 choice. */
  digestRollout?: boolean
  /** This parent's plan includes the weekly highlight. */
  weeklyIncluded?: boolean
  /** Set while the plan sheet is rolled out: opens 부모님께 드리는 선물. */
  onOpenPlans?: (reason: PlanReason) => void
  /** "Free", "Basic" …: the plan this person is on. */
  planName?: string
  /** How many family members the plan shares with; null when it isn't known. */
  familyLimit?: number | null
}

export function Settings({ settings, onChange, user, onSignOut, memos, activePatientUid, isSelf, onSwitchPatient, myRole, voiceRollout = false, reactionsRollout = false, digestRollout = false, weeklyIncluded = false, onOpenPlans, planName, familyLimit = null }: Props) {
  const toast = useToast()
  // A family-managed elder (부모님 등록하기): family runs 가족 관리 and
  // 기기 관리 for them, since the elder's phone has no settings at all.
  const isManaged = settings.accountType === 'managed'
  const [registering, setRegistering] = useState(false)

  // ─── caregiver-share state ───────────────────────────────────────────────
  // The owner sees their list of caregivers; revoke buttons call the cloud
  // function so the audit log gets written atomically.
  // Only subscribe where the rules allow it: our own family list, or a
  // managed parent's list when we're their guardian/admin. Anything else
  // would just log permission errors.
  const canManageHere = isSelf || (isManaged && (myRole === 'guardian' || myRole === 'admin'))
  const { caregivers } = useMemberships(canManageHere ? activePatientUid : undefined, { withPatients: false })
  // 부모님 삭제 is for the guardian (whoever registered the parent) only.
  const isGuardian = isManaged && !isSelf && myRole === 'guardian'
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const onDeleteElder = async () => {
    setDeleteBusy(true)
    const patientUid = activePatientUid
    const name = settings.patientName
    // Leave the parent's screens first: their live views would otherwise
    // fail with permission errors the moment their data is erased.
    onSwitchPatient(user.uid)
    toast.show(`${name}님을 삭제하는 중…`)
    try {
      await deleteManagedElder(patientUid)
      setDeleteOpen(false)
      toast.show(`${name}님을 삭제했어요`)
    } catch (err) {
      console.error('[elder] delete failed', err)
      onSwitchPatient(patientUid)
      toast.show('삭제하지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
    } finally {
      setDeleteBusy(false)
    }
  }
  // 가족초대 modal. Two steps in one overlay: (1) a single consent screen,
  // (2) send the invite link by KakaoTalk or text message. The code itself is
  // never shown — the recipient just taps the link.
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteStep, setInviteStep] = useState<'confirm' | 'send'>('confirm')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [showPhoneField, setShowPhoneField] = useState(false)
  const [invitePhone, setInvitePhone] = useState('')

  const activeFamily = caregivers.filter((m) => m.status === 'active' && m.caregiverUid !== activePatientUid).length
  const openInvite = () => {
    // 가족초대 at the plan's count: the plan sheet instead of the invite.
    if (onOpenPlans && familyLimit != null && activeFamily >= familyLimit) {
      onOpenPlans({ kind: 'family', limit: familyLimit })
      return
    }
    setInviteStep('confirm')
    setInviteCode('')
    setShowPhoneField(false)
    setInvitePhone('')
    setInviteOpen(true)
  }
  const closeInvite = () => { setInviteOpen(false); setInviteBusy(false) }

  const onCreateInvite = async () => {
    setInviteBusy(true)
    try {
      const res = await createInvite({
        patientUid: activePatientUid,
        // Family can edit by default (the common case is the elder's child);
        // it can be lowered to 뷰어 per person in 가족 관리.
        role: 'admin',
        sensitiveScope: '메모 텍스트와 사진',
        thirdPartyScope: '메모 + 위치 + 사진을 가족과 공유',
        // v2: the two consents merged into one screen and 보호자 → 가족 wording.
        consentTextVersion: 'v2',
      })
      setInviteCode(res.code)
      setInviteStep('send')
    } catch (err) {
      // The worker has the last word on the plan's count (the list here can lag).
      if (onOpenPlans && err instanceof WorkerError && err.code === 'plan-limit') {
        closeInvite()
        const d = err.details as { limit?: number; nextTier?: PlanTier | null } | undefined
        onOpenPlans({ kind: 'family', limit: d?.limit ?? familyLimit ?? activeFamily, nextTier: d?.nextTier })
        return
      }
      console.error('[invite] create failed', err)
      toast.show('초대 만들기에 실패했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해주세요')
    } finally {
      setInviteBusy(false)
    }
  }

  const onKakaoInvite = async () => {
    try {
      const result = await shareInviteToKakao(settings.patientName, inviteCode)
      if (result === 'copied') toast.show('초대 메시지를 복사했어요', '카카오톡에 붙여넣어 보내주세요')
    } catch (err) {
      console.error('[invite] kakao share failed', err)
      toast.show('카카오톡을 열 수 없어요', '전화번호로 초대해 주세요')
    }
  }

  const phoneDigits = invitePhone.replace(/\D+/g, '')
  const onSmsInvite = () => {
    if (phoneDigits.length < 9) return
    sendInviteSMS(invitePhone, settings.patientName, inviteCode)
  }

  const onRevoke = async (caregiverUid: string, caregiverLabel: string) => {
    if (!confirm(`${caregiverLabel}님의 접근을 해제할까요?`)) return
    try {
      await revokeMembership({ patientUid: activePatientUid, caregiverUid })
      toast.show('가족 접근을 해제했어요')
    } catch (err) {
      console.error('[revoke] failed', err)
      toast.show('해제에 실패했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : undefined)
    }
  }

  const onSetRole = async (caregiverUid: string, role: InvitableRole) => {
    try {
      await setMembershipRole({ patientUid: activePatientUid, caregiverUid, role })
      toast.show(role === 'admin' ? '관리자로 변경했어요' : '뷰어로 변경했어요')
    } catch (err) {
      console.error('[role] failed', err)
      toast.show('역할 변경에 실패했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : undefined)
    }
  }

  const update = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) => onChange({ ...settings, [k]: v })

  // 음성 답장: recording the parent's voice needs its own consent. Turning
  // it on files a 'voice_reply' consent (by the parent, or by family on a
  // managed parent's behalf) and only then shows the button on their phone.
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const agreeToVoice = async () => {
    setVoiceBusy(true)
    try {
      await addDoc(collection(db, 'consents'), {
        patientUid: activePatientUid,
        type: 'voice_reply',
        grantedBy: isSelf ? 'self' : 'guardian',
        guardianUid: isSelf ? null : user.uid,
        scope: '음성 답장 녹음과 받아쓴 글을 가족과 공유',
        consentTextVersion: VOICE_CONSENT_VERSION,
        timestamp: serverTimestamp(),
      })
      update('voiceEnabled', true)
      setVoiceOpen(false)
      toast.show('음성 답장을 켰어요')
    } catch (err) {
      console.error('[voice] consent failed', err)
      toast.show('켜지 못했어요', '잠시 후 다시 시도해 주세요')
    } finally {
      setVoiceBusy(false)
    }
  }

  // 집 위치: pick from places recent photos were taken (works for family
  // setting it up remotely), or use this phone's location on one's own account.
  const recentPlaces = (() => {
    const seen = new Set<string>()
    const out: { lat: number; lng: number; label: string }[] = []
    for (const m of memos) {
      if (m.lat == null || m.lng == null || !m.place || seen.has(m.place)) continue
      seen.add(m.place)
      out.push({ lat: m.lat, lng: m.lng, label: m.place })
      if (out.length === 4) break
    }
    return out
  })()
  const [locating, setLocating] = useState(false)
  const useCurrentAsHome = async () => {
    setLocating(true)
    const geo = await getGeo()
    setLocating(false)
    if (!geo) { toast.show('위치를 확인하지 못했어요', '위치 권한을 확인해 주세요'); return }
    update('home', { ...geo, label: '직접 설정한 위치' })
    toast.show('집 위치를 저장했어요')
  }

  // 하루 요약: when the worker sends the digest of this person's day.
  const digest = { ...DEFAULT_DIGEST, ...settings.digest }
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [digestBusy, setDigestBusy] = useState(false)
  const changeDigest = async (changes: Partial<DigestSettings>) => {
    setDigestBusy(true)
    try {
      await saveDigestSettings(activePatientUid, changes)
    } catch (err) {
      console.error('[digest] settings change failed', err)
      toast.show('바꾸지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
    } finally {
      setDigestBusy(false)
    }
  }

  const cadenceHint = settings.cadence === 'realtime'
    ? '사진을 찍을 때마다 바로 보내요'
    : settings.cadence === 'weekly'
      ? '매주 일요일에 한 주를 모아 보내요'
      : '매일 저녁 8시에 하루 요약을 보내요'

  return (
    <section className="page">
      <div className="h-eyebrow">가족 설정</div>
      <h2 className="h-title">설정</h2>

      {/* Account — kept so the user can sign out / see which Google account
          is in use. Not in the visual prototype but functionally important. */}
      <div className="sect">
        <div className="sect-lab">계정</div>
        <div className="row">
          <div className="account-row" style={{ flex: 1 }}>
            {user.photoURL && <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
            <div className="account-info">
              <div className="name">{user.displayName || '이름 없음'}</div>
              <div className="email">{user.email}</div>
            </div>
          </div>
          <button
            className="signout-btn"
            onClick={async () => {
              if (!confirm('로그아웃할까요?')) return
              try { await onSignOut() } catch (e) { console.error(e); toast.show('로그아웃에 실패했어요') }
            }}
          >로그아웃</button>
        </div>
      </div>

      {isSelf && (
        <div className="sect">
          <div className="sect-lab">부모님</div>
          <button className="linkbtn" onClick={() => setRegistering(true)}>
            <span>부모님 등록하기</span>
            <span aria-hidden="true">→</span>
          </button>
          <div className="help">
            부모님은 로그인할 필요가 없어요. 여기서 설정을 마치고 링크를 보내면, 부모님은 링크를 눌러 ‘연결하기’만 누르면 돼요.
          </div>
        </div>
      )}
      {registering && (
        <RegisterElder onClose={() => setRegistering(false)} onRegistered={onSwitchPatient} />
      )}

      {isManaged && !isSelf && canManageHere && (
        <ElderDevices patientUid={activePatientUid} patientName={settings.patientName} />
      )}

      <div className="sect">
        <div className="sect-lab">사용자 이름</div>
        <div className="row">
          <div className="who"><b>표시되는 이름</b><br /><span>가족 알림에 사용돼요</span></div>
          <input
            value={settings.patientName}
            onChange={(e) => update('patientName', e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 16, background: '#fff', width: 130, textAlign: 'right', fontFamily: 'inherit' }}
          />
        </div>
      </div>

      {canManageHere && (
        <div className="sect">
          <div className="sect-lab">집 위치</div>
          <div className="row">
            <div className="who">
              <b>{settings.home ? settings.home.label : '자동으로 추정해요'}</b><br />
              <span>
                {settings.home
                  ? '집에서 멀리 있을 때 찍은 사진은 여행·출장으로 기록해요'
                  : '사진을 가장 자주 찍는 곳을 집으로 봐요'}
              </span>
            </div>
            {settings.home && <button className="signout-btn" onClick={() => update('home', null)}>지우기</button>}
          </div>
          {recentPlaces.length > 0 && (
            <>
              <div className="help">최근 사진을 찍은 곳 중에 집이 있으면 골라 주세요.</div>
              <div className="name-chips">
                {recentPlaces.map((p) => (
                  <button
                    key={p.label}
                    className={`name-chip ${settings.home?.label === p.label ? 'on' : ''}`}
                    onClick={() => update('home', p)}
                  >{p.label}</button>
                ))}
              </div>
            </>
          )}
          {isSelf && (
            <button className="linkbtn" disabled={locating} onClick={useCurrentAsHome}>
              <span>{locating ? '위치 확인 중…' : '지금 있는 곳을 집으로 설정'}</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}

      {/* Caregiver-share management. Only shown when viewing the SIGNED-IN
          user's own account — caregivers viewing someone else's account
          don't get to invite or revoke from the patient's perspective. */}
      {canManageHere && (
        <div className="sect">
          <div className="sect-lab">가족 관리</div>
          {caregivers.length === 0 ? (
            <div className="row">
              <div className="who"><span>아직 함께하는 가족이 없어요.</span></div>
            </div>
          ) : caregivers.map((m) => {
            const isMe = m.caregiverUid === user.uid
            const label = (m.caregiverName || (m.caregiverUid.slice(0, 6) + '…')) + (isMe ? ' (나)' : '')
            const statusLabel = m.status === 'invited' ? '초대됨' : m.status === 'active' ? '활성' : '해제됨'
            const canSetRole = m.status === 'active' && m.role !== 'guardian' && !isMe
            return (
              <div className="cg-row" key={m.id}>
                <div className="row recipient-row">
                  <div className="who">
                    <b>{label}</b>
                    <span> · {m.role === 'guardian' ? '대표 가족 · ' : ''}{statusLabel}</span>
                  </div>
                  <div className="send-row">
                    {m.status !== 'revoked' && !isMe && (
                      <button
                        className="send-btn send-del"
                        onClick={() => onRevoke(m.caregiverUid, label)}
                        aria-label="가족 접근 해제"
                        title="해제"
                      >✕</button>
                    )}
                  </div>
                </div>
                {canSetRole && (
                  <div className="seg cg-role-seg">
                    <button
                      className={m.role === 'admin' ? 'on' : ''}
                      onClick={() => onSetRole(m.caregiverUid, 'admin')}
                    >관리자 (편집 가능)</button>
                    <button
                      className={m.role === 'viewer' ? 'on' : ''}
                      onClick={() => onSetRole(m.caregiverUid, 'viewer')}
                    >뷰어 (보기만)</button>
                  </div>
                )}
              </div>
            )
          })}
          <button className="linkbtn" onClick={openInvite} style={{ marginTop: 8 }}>
            <span>가족초대</span>
            <span aria-hidden="true">→</span>
          </button>
          <div className="help">
            카카오톡이나 문자로 초대 링크를 보낼 수 있어요. 링크는 24시간 동안 유효해요.
          </div>
        </div>
      )}

      {onOpenPlans && (
        <div className="sect">
          <div className="sect-lab">요금제</div>
          <div className="row">
            <div className="who"><b>{S.planCurrent}</b><br /><span>{planName ?? ''}</span></div>
          </div>
          <button className="linkbtn" onClick={() => onOpenPlans({ kind: 'settings' })}>
            <span>{S.planTitle}</span>
            <span aria-hidden="true">→</span>
          </button>
          <div className="help">가족이 함께 보는 방법과 사진을 보관하는 기간이 요금제마다 달라요.</div>
        </div>
      )}

      {digestRollout && canManageHere && (
        <div className="sect">
          <div className="sect-lab">하루 요약</div>
          <div className="seg">
            <button className={digest.cadence === 'daily' ? 'on' : ''} disabled={digestBusy} onClick={() => changeDigest({ cadence: 'daily' })}>매일 저녁</button>
            <button className={digest.cadence === 'weekly' ? 'on' : ''} disabled={digestBusy || !weeklyIncluded} onClick={() => changeDigest({ cadence: 'weekly' })}>
              매주 일요일{!weeklyIncluded && <> <span className="plan-chip">Plus 이상</span></>}
            </button>
          </div>
          <div className="row">
            <div className="who"><b>보내는 시간</b><br /><span>{digest.tz === 'Asia/Seoul' ? '한국 시간' : digest.tz} 기준</span></div>
            <select
              className="dg-hour"
              value={digest.hourLocal}
              disabled={digestBusy}
              onChange={(e) => changeDigest({ hourLocal: Number(e.target.value) })}
              aria-label="하루 요약을 보내는 시간"
            >
              {[...new Set([...DIGEST_HOURS, digest.hourLocal])].sort((a, b) => a - b).map((h) => (
                <option key={h} value={h}>{h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`}</option>
              ))}
            </select>
          </div>
          {deviceTz !== 'Asia/Seoul' && (
            <div className="seg" style={{ marginTop: 10 }}>
              <button className={digest.tz === 'Asia/Seoul' ? 'on' : ''} disabled={digestBusy} onClick={() => changeDigest({ tz: 'Asia/Seoul' })}>한국 시간</button>
              <button className={digest.tz === deviceTz ? 'on' : ''} disabled={digestBusy} onClick={() => changeDigest({ tz: deviceTz })}>이 기기의 시간</button>
            </div>
          )}
          <div className="help">
            {settings.patientName}님의 하루를 두세 문장으로 정리해 가족에게 보내요. 사진이 없는 날은 보내지 않아요. 받는 방법은 알림 탭에서 고를 수 있어요.
          </div>
        </div>
      )}

      {!digestRollout && <div className="sect">
        <div className="sect-lab">전송 시점</div>
        <div className="seg">
          <button
            className={settings.cadence === 'realtime' ? 'on' : ''}
            onClick={() => update('cadence', 'realtime')}
          >실시간</button>
          <button
            className={settings.cadence === 'daily' ? 'on' : ''}
            onClick={() => update('cadence', 'daily')}
          >매일 저녁</button>
          <button
            className={settings.cadence === 'weekly' ? 'on' : ''}
            onClick={() => update('cadence', 'weekly')}
          >매주</button>
        </div>
        <div className="help">{cadenceHint}</div>
      </div>}

      <div className="sect">
        <div className="sect-lab">자동 기록</div>
        <div className="row">
          <div className="who"><b>자동으로 기록·전송</b><br /><span>사진을 찍으면 바로 기록하고 보냅니다</span></div>
          <button
            className={`switch ${settings.autoMode ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.autoMode}
            onClick={() => update('autoMode', !settings.autoMode)}
            aria-label="자동 기록 전환"
          ><span className="knob" /></button>
        </div>
        <div className="help">끄면 보내기 전에 가족이 한 번 확인할 수 있어요</div>
      </div>

      {reactionsRollout && canManageHere && (
        <div className="sect">
          <div className="sect-lab">글로 답장</div>
          <div className="seg">
            <button className={(settings.textReplies ?? 'quick') === 'off' ? 'on' : ''} onClick={() => update('textReplies', 'off')}>끄기</button>
            <button className={(settings.textReplies ?? 'quick') === 'quick' ? 'on' : ''} onClick={() => update('textReplies', 'quick')}>짧은 답장</button>
            <button className={settings.textReplies === 'full' ? 'on' : ''} onClick={() => update('textReplies', 'full')}>직접 쓰기도</button>
          </div>
          <div className="help">
            {settings.textReplies === 'off' ? `${settings.patientName}님은 하트${settings.voiceEnabled ? '와 목소리' : ''}로만 답해요.`
              : settings.textReplies === 'full' ? `${settings.patientName}님이 “고마워” 같은 짧은 답장을 누르거나, 직접 써서 답할 수 있어요.`
              : `${settings.patientName}님이 “고마워”, “밥 먹었어” 같은 짧은 답장을 한 번 눌러 보낼 수 있어요. 자판은 나오지 않아요.`}
          </div>
        </div>
      )}

      {voiceRollout && canManageHere && (
        <div className="sect">
          <div className="sect-lab">음성 답장</div>
          <div className="row">
            <div className="who"><b>목소리로 답장 받기</b><br /><span>{settings.patientName}님이 버튼을 꾹 누르고 말하면 가족에게 전해져요</span></div>
            <button
              className={`switch ${settings.voiceEnabled ? 'on' : ''}`}
              role="switch"
              aria-checked={!!settings.voiceEnabled}
              onClick={() => (settings.voiceEnabled ? update('voiceEnabled', false) : setVoiceOpen(true))}
              aria-label="음성 답장 전환"
            ><span className="knob" /></button>
          </div>
          <div className="help">처음 말할 때 {settings.patientName}님 휴대폰이 마이크 사용을 한 번 물어봐요.</div>
        </div>
      )}

      <div className="sect">
        <div className="sect-lab">글자 크기</div>
        <div className="seg">
          <button
            className={!settings.bigText ? 'on' : ''}
            onClick={() => update('bigText', false)}
          >보통</button>
          <button
            className={settings.bigText ? 'on' : ''}
            onClick={() => update('bigText', true)}
          >크게</button>
        </div>
      </div>

      {!onOpenPlans && <div className="sect">
        <div className="sect-lab">사진 보관</div>
        <div className="seg">
          <button
            className={settings.retention === '30' ? 'on' : ''}
            onClick={() => update('retention', '30')}
          >30일</button>
          <button
            className={settings.retention === '90' ? 'on' : ''}
            onClick={() => update('retention', '90')}
          >90일</button>
          <button
            className={settings.retention === 'forever' ? 'on' : ''}
            onClick={() => update('retention', 'forever')}
          >계속</button>
        </div>
        <div className="help">기간이 지난 사진은 자동 삭제됩니다.</div>
      </div>}

      <div className="proto-note">
        <b>Phase 1 안내.</b> 사진은 Firebase Cloud Storage에 저장되고, 메모는 Firestore에 기록됩니다.
        카카오톡 발송은 Phase 2에 추가됩니다.
      </div>

      {/* 가족초대 modal — two steps in one overlay.
          Step 1 (confirm): one consent screen. Tapping "동의하고 초대하기"
          has the worker write both consents + the invite + audit log in one
          batch.
          Step 2 (send): KakaoTalk or text message — nothing else. */}
      {isGuardian && (
        <div className="sect">
          <div className="sect-lab">부모님 삭제</div>
          <button className="linkbtn danger-btn" onClick={() => setDeleteOpen(true)}>
            <span>{settings.patientName}님 삭제하기</span>
          </button>
          <div className="help">
            잘못 등록했거나 더 이상 쓰지 않을 때만 사용하세요. 사진과 기록이 모두 지워지고 되돌릴 수 없어요.
          </div>
        </div>
      )}
      {voiceOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">음성 답장 동의</div>
            <div className="modal-body">
              <p>{isSelf ? '아래 내용에 동의합니다.' : `${settings.patientName}님을 대신해 아래 내용에 동의합니다.`}</p>
              <ul className="consent-list">
                <li>{settings.patientName}님이 남기는 음성 답장(15초 이내 녹음)을 저장해요.</li>
                <li>녹음을 글로 받아쓰고, 녹음과 글을 가족에게 보여줘요.</li>
                <li>받아쓰기는 외부 서비스로 보내지 않고 우리 서버에서만 해요.</li>
              </ul>
              <div className="help">동의는 기록으로 남아요. 언제든 다시 끌 수 있어요.</div>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" disabled={voiceBusy} onClick={() => setVoiceOpen(false)}>취소</button>
              <button className="linkbtn" disabled={voiceBusy} onClick={agreeToVoice}>
                <span>{voiceBusy ? '켜는 중…' : '동의하고 켜기'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">{settings.patientName}님을 삭제할까요?</div>
            <div className="modal-body">
              <p>{settings.patientName}님의 사진·기록·설정이 모두 지워지고, 연결된 휴대폰과 가족 모두 더 이상 볼 수 없어요. 되돌릴 수 없어요.</p>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>취소</button>
              <button className="linkbtn danger-btn" disabled={deleteBusy} onClick={onDeleteElder}>
                <span>{deleteBusy ? '삭제하는 중…' : '삭제하기'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            {inviteStep === 'confirm' ? (
              <>
                <div className="modal-title">가족초대</div>
                <div className="modal-body">
                  <p>가족을 초대하면 내 일상 기록(메모·사진·위치)을 초대한 가족이 함께 볼 수 있어요.</p>
                  <div className="help" style={{ marginTop: 10 }}>
                    아래 버튼을 누르면 민감정보(메모·사진) 처리와 가족에게 제공(제3자 제공)에 동의하는 것으로 기록돼요.
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="signin-secondary" onClick={closeInvite}>취소</button>
                  <button
                    className="linkbtn"
                    disabled={inviteBusy}
                    onClick={onCreateInvite}
                  >
                    <span>{inviteBusy ? '만드는 중…' : '동의하고 초대하기'}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">초대 보내기</div>
                <div className="modal-body">
                  <div className="invite-send">
                    <button className="invite-btn invite-kakao" onClick={onKakaoInvite}>
                      카카오톡으로 초대
                    </button>
                    {showPhoneField ? (
                      <div className="invite-phone">
                        <label htmlFor="invite-phone">받는 사람 전화번호</label>
                        <input
                          id="invite-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="010-1234-5678"
                          value={invitePhone}
                          onChange={(e) => setInvitePhone(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') onSmsInvite() }}
                          autoFocus
                        />
                        <button
                          className="invite-btn invite-sms"
                          onClick={onSmsInvite}
                          disabled={phoneDigits.length < 9}
                        >
                          문자 보내기
                        </button>
                      </div>
                    ) : (
                      <button className="invite-btn invite-sms" onClick={() => setShowPhoneField(true)}>
                        전화번호로 초대
                      </button>
                    )}
                  </div>
                  <div className="help" style={{ textAlign: 'center', marginTop: 12 }}>
                    초대 링크는 24시간 동안 1명만 사용할 수 있어요.
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="signin-secondary" onClick={closeInvite}>완료</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
