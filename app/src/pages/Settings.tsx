import { useState } from 'react'
import type { User } from 'firebase/auth'
import type { UserSettings, Memo } from '../types'
import { useToast } from '../components/Toast'
import { useMemberships } from '../hooks/useMemberships'
import {
  createInvite,
  revokeMembership,
  setMembershipRole,
  formatInviteCode,
  type InvitableRole,
} from '../lib/caregiver'

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
   *  invite-management section (only the patient can invite caregivers
   *  to their own account) and whether to show the accept-another-invite
   *  shortcut. */
  isSelf: boolean
  /** Called when the user taps "초대 코드로 참여하기" in caregiver mode. */
  onOpenAcceptInvite: () => void
}

export function Settings({ settings, onChange, user, onSignOut, activePatientUid, isSelf, onOpenAcceptInvite }: Props) {
  const toast = useToast()

  // ─── caregiver-share state ───────────────────────────────────────────────
  // The owner sees their list of caregivers; revoke buttons call the cloud
  // function so the audit log gets written atomically.
  const { caregivers } = useMemberships(activePatientUid)
  // Invite modal state. Two steps: (1) consent text shown to patient,
  // (2) generated code reveal. We don't separate them into routes — the
  // single modal swaps content based on `inviteStep`.
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteStep, setInviteStep] = useState<'consent' | 'code'>('consent')
  // The managing caregiver (the elder's child) is the common case, so default to
  // 관리자(편집 가능); 뷰어 stays selectable in the picker for view-only relatives.
  const [inviteRole, setInviteRole] = useState<InvitableRole>('admin')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteExpiresAt, setInviteExpiresAt] = useState('')

  const openInvite = () => {
    setInviteRole('admin')
    setInviteStep('consent')
    setInviteCode('')
    setInviteOpen(true)
  }
  const closeInvite = () => { setInviteOpen(false); setInviteBusy(false) }

  const onGenerateCode = async () => {
    setInviteBusy(true)
    try {
      const res = await createInvite({
        patientUid: activePatientUid,
        role: inviteRole,
        sensitiveScope: '메모 텍스트와 사진',
        thirdPartyScope: '메모 + 위치 + 사진을 보호자와 공유',
        consentTextVersion: 'v1',
      })
      setInviteCode(res.code)
      setInviteExpiresAt(res.expiresAt)
      setInviteStep('code')
    } catch (err) {
      console.error('[invite] create failed', err)
      toast.show('초대 코드 생성에 실패했어요', '잠시 후 다시 시도해주세요')
    } finally {
      setInviteBusy(false)
    }
  }

  const onCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode)
      toast.show('코드를 복사했어요')
    } catch {
      // Some browsers (older Safari over HTTP) block clipboard — we degrade
      // silently; the code is on-screen and the user can read it aloud.
    }
  }

  const onShareCode = async () => {
    const text = `[오늘하루] 초대 코드: ${formatInviteCode(inviteCode)}\nhttps://trackbyphoto.web.app/accept?code=${inviteCode}`
    if (navigator.share) {
      try { await navigator.share({ title: '오늘하루 초대', text }) }
      catch { /* user cancelled */ }
    } else {
      onCopyCode()
    }
  }

  const onRevoke = async (caregiverUid: string, caregiverLabel: string) => {
    if (!confirm(`${caregiverLabel} 보호자의 접근을 해제할까요?`)) return
    try {
      await revokeMembership({ patientUid: activePatientUid, caregiverUid })
      toast.show('보호자 접근을 해제했어요')
    } catch (err) {
      console.error('[revoke] failed', err)
      toast.show('해제에 실패했어요')
    }
  }

  const onSetRole = async (caregiverUid: string, role: InvitableRole) => {
    try {
      await setMembershipRole({ patientUid: activePatientUid, caregiverUid, role })
      toast.show(role === 'admin' ? '관리자로 변경했어요' : '뷰어로 변경했어요')
    } catch (err) {
      console.error('[role] failed', err)
      toast.show('역할 변경에 실패했어요')
    }
  }

  const update = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) => onChange({ ...settings, [k]: v })

  const cadenceHint = settings.cadence === 'realtime'
    ? '사진을 찍을 때마다 바로 보내요'
    : settings.cadence === 'weekly'
      ? '매주 일요일에 한 주를 모아 보내요'
      : '매일 저녁 8시에 하루 요약을 보내요'

  return (
    <section className="page">
      <div className="h-eyebrow">가족 · 보호자 설정</div>
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

      {/* Caregiver-share management. Only shown when viewing the SIGNED-IN
          user's own account — caregivers viewing someone else's account
          don't get to invite or revoke from the patient's perspective. */}
      {isSelf && (
        <div className="sect">
          <div className="sect-lab">보호자 관리</div>
          {caregivers.length === 0 ? (
            <div className="row">
              <div className="who"><span>아직 등록된 보호자가 없어요.</span></div>
            </div>
          ) : caregivers.map((m) => {
            const label = m.caregiverName || (m.caregiverUid.slice(0, 6) + '…')
            const statusLabel = m.status === 'invited' ? '초대됨' : m.status === 'active' ? '활성' : '해제됨'
            const canSetRole = m.status === 'active' && m.role !== 'guardian'
            return (
              <div className="cg-row" key={m.id}>
                <div className="row recipient-row">
                  <div className="who">
                    <b>{label}</b>
                    <span> · {m.role === 'guardian' ? '후견인 · ' : ''}{statusLabel}</span>
                  </div>
                  <div className="send-row">
                    {m.status !== 'revoked' && (
                      <button
                        className="send-btn send-del"
                        onClick={() => onRevoke(m.caregiverUid, label)}
                        aria-label="보호자 접근 해제"
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
            <span>보호자 초대하기</span>
            <span aria-hidden="true">→</span>
          </button>
          <div className="help">
            보호자에게 6자리 코드를 알려주세요. 코드는 24시간 동안만 사용할 수 있어요.
          </div>
        </div>
      )}

      {/* Even when viewing as caregiver, surface a way to join another elder
          (e.g., a son caring for both parents). Owner sees this too — they
          can be a caregiver on someone else's account at the same time. */}
      <div className="sect">
        <div className="sect-lab">다른 사용자 돌보기</div>
        <button className="linkbtn" onClick={onOpenAcceptInvite}>
          <span>초대 코드로 참여하기</span>
          <span aria-hidden="true">→</span>
        </button>
        <div className="help">
          다른 사용자에게 받은 6자리 초대 코드를 입력하세요.
        </div>
      </div>

      <div className="sect">
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
      </div>

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

      <div className="sect">
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
      </div>

      <div className="proto-note">
        <b>Phase 1 안내.</b> 사진은 Firebase Cloud Storage에 저장되고, 메모는 Firestore에 기록됩니다.
        카카오톡 발송은 Phase 2에 추가됩니다.
      </div>

      {/* Invite modal — two steps in one overlay.
          Step 1 (consent): patient reads the two PIPA notices and selects
          the caregiver's role. Tap "동의하고 코드 발급" triggers the cloud
          function which writes both consents + the invite + audit log in
          one batch.
          Step 2 (code): patient sees the 6-digit code, can copy or share. */}
      {inviteOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            {inviteStep === 'consent' ? (
              <>
                <div className="modal-title">보호자 초대 동의</div>
                <div className="modal-body">
                  <div className="consent-block">
                    <b>1. 민감정보 처리 동의</b>
                    <p>일상 메모와 사진을 앱이 저장·처리하는 것에 동의합니다.</p>
                  </div>
                  <div className="consent-block">
                    <b>2. 제3자 제공 동의</b>
                    <p>보호자(가족)에게 메모·위치·사진을 공유하는 것에 동의합니다.</p>
                  </div>

                  <div className="seg" style={{ marginTop: 12 }}>
                    <button
                      className={inviteRole === 'admin' ? 'on' : ''}
                      onClick={() => setInviteRole('admin')}
                    >관리자 (편집 가능)</button>
                    <button
                      className={inviteRole === 'viewer' ? 'on' : ''}
                      onClick={() => setInviteRole('viewer')}
                    >뷰어 (보기만)</button>
                  </div>
                  <div className="help" style={{ marginTop: 8 }}>
                    관리자는 메모를 수정하거나 다른 보호자를 초대할 수 있어요.
                    뷰어는 보기만 가능해요.
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="signin-secondary" onClick={closeInvite}>취소</button>
                  <button
                    className="linkbtn"
                    disabled={inviteBusy}
                    onClick={onGenerateCode}
                  >
                    <span>{inviteBusy ? '생성 중…' : '동의하고 코드 발급'}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">초대 코드</div>
                <div className="modal-body">
                  <div className="invite-code-display">{formatInviteCode(inviteCode)}</div>
                  <div className="help" style={{ textAlign: 'center' }}>
                    이 코드를 보호자에게 알려주세요.
                  </div>
                  <div className="help" style={{ textAlign: 'center', marginTop: 4 }}>
                    {inviteExpiresAt && `${new Date(inviteExpiresAt).toLocaleString('ko-KR')}까지 유효`}
                  </div>
                  <div className="modal-actions" style={{ marginTop: 16 }}>
                    <button className="signin-secondary" onClick={onCopyCode}>코드 복사</button>
                    <button className="linkbtn" onClick={onShareCode}>
                      <span>공유하기</span>
                      <span aria-hidden="true">→</span>
                    </button>
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
