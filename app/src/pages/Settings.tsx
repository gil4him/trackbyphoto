import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { DigestSettings, UserSettings, Memo, MemoStyle } from '../types'
import { useToast } from '../components/Toast'
import { useMemberships, type LiveMembership } from '../hooks/useMemberships'
import { honorific, honorificWith } from '../lib/people'
import type { Person } from '../lib/people'
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
import { ParentAppStatus } from '../components/ParentAppStatus'
import { BottomSheet } from '../components/BottomSheet'
import { deleteManagedElder } from '../lib/pairing'
import { deleteMyAccount } from '../lib/account'
import { DEFAULT_DIGEST, DIGEST_HOURS, noticeHourChoices, noticeHourLabel, saveDigestSettings } from '../lib/digest'
import type { PlanReason } from '../lib/plan'
import { S } from '../lib/strings'
import type { PlanTier } from '../types'
import { isSimple } from '../lib/edition'
import { ShareAppRow } from '../components/ShareApp'
import { defaultTextReplies } from '../lib/textReplies'
import { LegalLinks } from '../components/LegalLinks'
import { PUBLIC_ORIGIN } from '../lib/publicUrl'
import { SectLab } from '../components/SectLab'
import { PushToggle } from '../components/PushToggle'
import { HomePicker } from '../components/HomePicker'
import { dropLocalCache } from '../lib/localCache'
import { lang, legalPath, setLang, tr, type Lang } from '../lib/lang'

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
  /** Opened from a phone notice: start at this parent's device list. */
  focusDevices?: boolean
  onDevicesFocused?: () => void
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
  /** Photos from family are rolled out: the 대표 가족 can switch them for this parent. */
  familyPhotosRollout?: boolean
  /** The people the signed-in user looks after: the same list as the
   *  switcher at the top of the app. */
  people?: Person<LiveMembership>[]
  /** The lowest plan that includes it ("Plus"), for the chip. */
  weeklyFrom?: string | null
  /** Set while the plan sheet is rolled out: opens 부모님께 드리는 선물. */
  onOpenPlans?: (reason: PlanReason) => void
  /** Simple edition: open the plan sheet for one of the parents this person manages. */
  onOpenPlansFor?: (patientUid: string) => void
  /** "Free", "Basic" …: the plan this person is on. */
  planName?: string
  /** How many family members the plan shares with; null when it isn't known. */
  familyLimit?: number | null
  /** Family push is rolled out: the simple edition's 설정 › 알림 has the 앱 알림 switch. */
  pushRollout?: boolean
}

// The simple edition adds 알림 시간 (the evening photo count) and leaves out
// the developer note.
const simple = isSimple()
/** 설정 → 메모 말투 (memo v2): the worker's model words the memos this way. */
const MEMO_STYLES: [MemoStyle, string][] = [['plain', tr('담백하게', 'Plain')], ['warm', tr('다정하게', 'Warm')], ['playful', tr('재치있게', 'Playful')]]
/** Each language in its own name, so anyone can find theirs. */
const LANGS: [Lang, string][] = [['ko', '한국어'], ['en', 'English']]

export function Settings({ settings, onChange, user, onSignOut, activePatientUid, focusDevices = false, onDevicesFocused, isSelf, onSwitchPatient, myRole, voiceRollout = false, reactionsRollout = false, digestRollout = false, weeklyIncluded = false, weeklyFrom = null, people = [], familyPhotosRollout = false, onOpenPlans, onOpenPlansFor, planName, familyLimit = null, pushRollout = false }: Props) {
  const toast = useToast()
  // A family-managed elder (부모님 등록하기): family runs 가족 관리 and
  // 기기 관리 for them, since the elder's phone has no settings at all.
  const isManaged = settings.accountType === 'managed'
  // Opened from a phone notice: start at the device list, once.
  const devicesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusDevices) return
    devicesRef.current?.scrollIntoView({ block: 'start' })
    onDevicesFocused?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDevices])
  const [registering, setRegistering] = useState(false)

  // ─── caregiver-share state ───────────────────────────────────────────────
  // The owner sees their list of caregivers; revoke buttons call the cloud
  // function so the audit log gets written atomically.
  // Only subscribe where the rules allow it: our own family list, or a
  // managed parent's list when we're their guardian/admin. Anything else
  // would just log permission errors.
  const canManageHere = isSelf || (isManaged && (myRole === 'guardian' || myRole === 'admin'))
  // 글로 답장: typing (with phrases underneath) unless family chose otherwise.
  const textReplies = settings.textReplies ?? defaultTextReplies()
  const { caregivers } = useMemberships(canManageHere ? activePatientUid : undefined, { withPatients: false })
  // 부모님 삭제 is for the guardian (whoever registered the parent) only.
  const isGuardian = isManaged && !isSelf && myRole === 'guardian'
  // Who is about to be deleted: the parent being viewed (부모님 삭제 at the
  // bottom) or one picked from 함께 보는 가족.
  const [deleteTarget, setDeleteTarget] = useState<{ patientUid: string; name: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const onDeleteElder = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    const { patientUid, name } = deleteTarget
    // Leave the parent's screens first: their live views would otherwise
    // fail with permission errors the moment their data is erased.
    if (activePatientUid === patientUid) onSwitchPatient(user.uid)
    toast.show(tr(`${honorificWith(name, '를')} 삭제하는 중…`, `Removing ${honorific(name)}…`))
    try {
      await deleteManagedElder(patientUid)
      setDeleteTarget(null)
      toast.show(tr(`${honorificWith(name, '를')} 삭제했어요`, `${honorific(name)} is removed`))
    } catch (err) {
      console.error('[elder] delete failed', err)
      if (activePatientUid === patientUid) onSwitchPatient(patientUid)
      toast.show(tr('삭제하지 못했어요', "Couldn't delete it"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
    } finally {
      setDeleteBusy(false)
    }
  }
  // 계정 삭제 — this person erasing their own account (App Store 5.1.1(v)).
  // Only a real sign-in has one to delete; a parent's phone never gets here.
  const canDeleteMe = !!user.email
  const [deleteMeOpen, setDeleteMeOpen] = useState(false)
  const [langBusy, setLangBusy] = useState(false)
  /** Save my language on my account first (App.tsx follows the account on
   *  every phone), then switch this phone. With no account doc to save on,
   *  only this phone switches. */
  const changeMyLang = async (next: Lang) => {
    if (next === lang) return
    setLangBusy(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), { geoLang: next, lastModifiedBy: user.uid, lastModifiedAt: serverTimestamp() })
    } catch (e) {
      if ((e as { code?: string }).code !== 'not-found') {
        console.error('[settings] language', e)
        toast.show(tr('바꾸지 못했어요', "Couldn't change it"), tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
        setLangBusy(false)
        return
      }
    }
    setLang(next)
  }
  const [deleteMeBusy, setDeleteMeBusy] = useState(false)
  const onDeleteMyAccount = async () => {
    setDeleteMeBusy(true)
    try {
      await deleteMyAccount(user.uid)
      setDeleteMeOpen(false)
      // The account itself is already gone; this clears the sign-in off the
      // phone so the app lands back on the first screen, without the copy of
      // the account's data the phone kept.
      await onSignOut()
      await dropLocalCache('/')
    } catch (err) {
      console.error('[account] delete failed', err)
      toast.show(tr('삭제하지 못했어요', "Couldn't delete it"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
      setDeleteMeBusy(false)
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
      toast.show(tr('초대 만들기에 실패했어요', "Couldn't make the invite"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해주세요', 'Please try again in a moment'))
    } finally {
      setInviteBusy(false)
    }
  }

  const onKakaoInvite = async () => {
    try {
      const result = await shareInviteToKakao(settings.patientName, inviteCode)
      if (result === 'copied') toast.show(tr('초대 메시지를 복사했어요', 'The invite message is copied'), tr('카카오톡에 붙여넣어 보내주세요', 'Paste it into KakaoTalk and send it'))
    } catch (err) {
      console.error('[invite] kakao share failed', err)
      toast.show(tr('카카오톡을 열 수 없어요', "KakaoTalk won't open"), tr('전화번호로 초대해 주세요', 'Please invite by phone number'))
    }
  }

  const phoneDigits = invitePhone.replace(/\D+/g, '')
  const onSmsInvite = () => {
    if (phoneDigits.length < 9) return
    sendInviteSMS(invitePhone, settings.patientName, inviteCode)
  }

  const onRevoke = async (caregiverUid: string, caregiverLabel: string) => {
    if (!confirm(tr(`${caregiverLabel}님의 접근을 해제할까요?`, `Remove ${caregiverLabel}'s access?`))) return
    try {
      await revokeMembership({ patientUid: activePatientUid, caregiverUid })
      toast.show(tr('가족 접근을 해제했어요', 'Their access is removed'))
    } catch (err) {
      console.error('[revoke] failed', err)
      toast.show(tr('해제에 실패했어요', "Couldn't remove it"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : undefined)
    }
  }

  // 함께 보는 가족 → 빼기: stop following someone (my own access only).
  const onLeave = async (patientUid: string, name: string) => {
    if (!confirm(tr(`${honorificWith(name, '를')} 내 목록에서 뺄까요?\n${honorific(name)}의 사진과 기록은 그대로 남고, 나만 더 이상 볼 수 없게 돼요.`, `Take ${honorific(name)} off my list?\n${honorific(name)}'s photos and records stay; only I stop seeing them.`))) return
    try {
      await revokeMembership({ patientUid, caregiverUid: user.uid })
      toast.show(tr(`${honorificWith(name, '를')} 목록에서 뺐어요`, `${honorific(name)} is off my list`))
    } catch (err) {
      console.error('[leave] failed', err)
      toast.show(tr('빼지 못했어요', "Couldn't take them off"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
    }
  }

  const onSetRole = async (caregiverUid: string, role: InvitableRole) => {
    try {
      await setMembershipRole({ patientUid: activePatientUid, caregiverUid, role })
      toast.show(role === 'admin' ? tr('관리자로 변경했어요', 'Now a manager') : tr('뷰어로 변경했어요', 'Now a viewer'))
    } catch (err) {
      console.error('[role] failed', err)
      toast.show(tr('역할 변경에 실패했어요', "Couldn't change the role"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : undefined)
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
      toast.show(tr('음성 답장을 켰어요', 'Voice replies are on'))
    } catch (err) {
      console.error('[voice] consent failed', err)
      toast.show(tr('켜지 못했어요', "Couldn't turn it on"), tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
    } finally {
      setVoiceBusy(false)
    }
  }

  // 언어: one's own account is seeded with the phone's language; anyone else
  // without one reads as Korean, as the worker does.
  const geoLang = settings.geoLang ?? 'ko'

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
      toast.show(tr('바꾸지 못했어요', "Couldn't change it"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
    } finally {
      setDigestBusy(false)
    }
  }

  const cadenceHint = settings.cadence === 'realtime'
    ? tr('사진을 찍을 때마다 바로 보내요', 'Sent as soon as a photo is taken')
    : settings.cadence === 'weekly'
      ? tr('매주 일요일에 한 주를 모아 보내요', 'The whole week is sent together every Sunday')
      : tr('매일 저녁 8시에 하루 요약을 보내요', 'A summary of the day is sent at 8 in the evening')

  // Dialogs shared by both layouts: 계정 삭제, 음성 답장 consent, 부모님 삭제, 가족초대.
  const modals = (
    <>
      {deleteMeOpen && (
        <BottomSheet title={tr('계정을 삭제할까요?', 'Delete your account?')} onClose={() => { if (!deleteMeBusy) setDeleteMeOpen(false) }}>
          <p className="sheet-sub">{tr('내 사진과 기록, 가족 연결이 모두 지워지고 되돌릴 수 없어요.', "Your photos, your records and your family links are all erased, and it can't be undone.")}</p>
          <div className="help" style={{ textAlign: 'center', margin: '-8px 0 14px' }}>
            {tr('부모님 기록은 지워지지 않아요 — 지우려면 먼저 부모님 관리에서 삭제해 주세요.', "Your parent's records are not erased — to erase them, remove the parent first.")}
            {onOpenPlans && <><br />{tr('구독 중이라면 스토어에서 먼저 해지해 주세요. 계정을 지워도 결제는 멈추지 않아요.', 'If you have a subscription, cancel it in the store first. Deleting the account does not stop the payments.')}</>}
          </div>
          <button type="button" className="sheet-danger-btn" disabled={deleteMeBusy} onClick={onDeleteMyAccount}>
            {deleteMeBusy ? tr('삭제하는 중…', 'Deleting…') : tr('계정 삭제', 'Delete account')}
          </button>
          <button type="button" className="sheet-cancel" disabled={deleteMeBusy} onClick={() => setDeleteMeOpen(false)}>{tr('취소', 'Cancel')}</button>
        </BottomSheet>
      )}
      {voiceOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">{tr('음성 답장 동의', 'Consent for voice replies')}</div>
            <div className="modal-body">
              <p>{isSelf ? tr('아래 내용에 동의합니다.', 'I agree to what follows.') : tr(`${honorificWith(settings.patientName, '를')} 대신해 아래 내용에 동의합니다.`, `I agree to what follows on ${honorific(settings.patientName)}'s behalf.`)}</p>
              <ul className="consent-list">
                <li>{tr(`${honorificWith(settings.patientName, '가')} 남기는 음성 답장(15초 이내 녹음)을 저장해요.`, `The voice replies ${honorific(settings.patientName)} leaves (recordings of up to 15 seconds) are kept.`)}</li>
                <li>{tr('녹음을 글로 받아쓰고, 녹음과 글을 가족에게 보여줘요.', 'The recording is written down, and family see both the recording and the writing.')}</li>
                <li>{tr('받아쓰기는 외부 서비스로 보내지 않고 우리 서버에서만 해요.', 'The writing down happens on our own server, never sent to an outside service.')}</li>
              </ul>
              <div className="help">{tr('동의는 기록으로 남아요. 언제든 다시 끌 수 있어요.', 'Your consent is kept on record. You can turn it off again at any time.')}</div>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" disabled={voiceBusy} onClick={() => setVoiceOpen(false)}>{tr('취소', 'Cancel')}</button>
              <button className="linkbtn" disabled={voiceBusy} onClick={agreeToVoice}>
                <span>{voiceBusy ? tr('켜는 중…', 'Turning it on…') : tr('동의하고 켜기', 'Agree and turn it on')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">{tr(`${honorificWith(deleteTarget.name, '를')} 삭제할까요?`, `Remove ${honorific(deleteTarget.name)}?`)}</div>
            <div className="modal-body">
              <p>{tr(`${honorific(deleteTarget.name)}의 사진·기록·설정이 모두 지워지고, 연결된 휴대폰과 가족 모두 더 이상 볼 수 없어요. 되돌릴 수 없어요.`, `${honorific(deleteTarget.name)}'s photos, records and settings are all erased, and neither the linked phone nor the family can see them any more. It can't be undone.`)}</p>
            </div>
            <div className="modal-actions">
              <button className="signin-secondary" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>{tr('취소', 'Cancel')}</button>
              <button className="linkbtn danger-btn" disabled={deleteBusy} onClick={onDeleteElder}>
                <span>{deleteBusy ? tr('삭제하는 중…', 'Removing…') : tr('삭제하기', 'Remove')}</span>
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
                <div className="modal-title">{tr('가족초대', 'Invite family')}</div>
                <div className="modal-body">
                  <p>{tr('가족을 초대하면 내 일상 기록(메모·사진·위치)을 초대한 가족이 함께 볼 수 있어요.', 'Invite family and they can see your daily records — memos, photos and places — with you.')}</p>
                  <div className="help" style={{ marginTop: 10 }}>
                    {tr('아래 버튼을 누르면 민감정보(메모·사진) 처리와 가족에게 제공(제3자 제공)에 동의하는 것으로 기록돼요.', 'Tapping the button below is recorded as your consent to handling sensitive data (memos and photos) and sharing it with family (a third party).')}
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="signin-secondary" onClick={closeInvite}>{tr('취소', 'Cancel')}</button>
                  <button
                    className="linkbtn"
                    disabled={inviteBusy}
                    onClick={onCreateInvite}
                  >
                    <span>{inviteBusy ? tr('만드는 중…', 'Making it…') : tr('동의하고 초대하기', 'Agree and invite')}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">{tr('초대 보내기', 'Send the invite')}</div>
                <div className="modal-body">
                  <div className="invite-send">
                    <button className="invite-btn invite-kakao" onClick={onKakaoInvite}>
                      {tr('카카오톡으로 초대', 'Invite by KakaoTalk')}
                    </button>
                    {showPhoneField ? (
                      <div className="invite-phone">
                        <label htmlFor="invite-phone">{tr('받는 사람 전화번호', "Their phone number")}</label>
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
                          {tr('문자 보내기', 'Send a text')}
                        </button>
                      </div>
                    ) : (
                      <button className="invite-btn invite-sms" onClick={() => setShowPhoneField(true)}>
                        {tr('전화번호로 초대', 'Invite by phone number')}
                      </button>
                    )}
                  </div>
                  <div className="help" style={{ textAlign: 'center', marginTop: 12 }}>
                    {tr('초대 링크는 24시간 동안 1명만 사용할 수 있어요.', 'The invite link works for 24 hours, for one person only.')}
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="signin-secondary" onClick={closeInvite}>{tr('완료', 'Done')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )

  // ── Simple edition (docs/DAYLIE_V3_UI_FIX.md A5) ──────────────────────────
  // Only 계정 · 부모님 · 알림 · 도움말·약관 · 로그아웃 · 계정 삭제, in that order.
  // A family member's 삭제 / 빼기 / 접근 해제 sits under ⋯ with a confirm sheet.
  const [rowMenu, setRowMenu] = useState<null | { kind: 'person'; patientUid: string; name: string; mine: boolean } | { kind: 'member'; caregiverUid: string; label: string; role: string; canSetRole: boolean; canRevoke: boolean }>(null)
  const [ask, setAsk] = useState<null | { title: string; sub?: string; label: string; run: () => Promise<void> | void }>(null)
  const [askBusy, setAskBusy] = useState(false)
  const runAsk = async () => {
    if (!ask) return
    setAskBusy(true)
    try { await ask.run() } finally { setAskBusy(false); setAsk(null) }
  }
  const leaveQuietly = async (patientUid: string, name: string) => {
    try {
      await revokeMembership({ patientUid, caregiverUid: user.uid })
      toast.show(tr(`${honorificWith(name, '를')} 목록에서 뺐어요`, `${honorific(name)} is off my list`))
    } catch (err) {
      console.error('[leave] failed', err)
      toast.show(tr('빼지 못했어요', "Couldn't take them off"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : tr('잠시 후 다시 시도해 주세요', 'Please try again in a moment'))
    }
  }
  const revokeQuietly = async (caregiverUid: string) => {
    try {
      await revokeMembership({ patientUid: activePatientUid, caregiverUid })
      toast.show(tr('가족 접근을 해제했어요', 'Their access is removed'))
    } catch (err) {
      console.error('[revoke] failed', err)
      toast.show(tr('해제에 실패했어요', "Couldn't remove it"), isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : undefined)
    }
  }

  if (simple) {
    return (
      <section className="page settings-simple">
        <div className="sect">
          <SectLab>{tr('계정', 'Account')}</SectLab>
          <div className="row">
            <div className="account-row" style={{ flex: 1 }}>
              {user.photoURL && <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
              <div className="account-info">
                <div className="name">{user.displayName || tr('이름 없음', 'No name')}</div>
                <div className="email">{user.email}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="sect">
          {/* The screens' language on this phone, kept on my account (users/{me}.geoLang) so it follows me. */}
          <SectLab>{tr('언어', 'Language')}</SectLab>
          <div className="seg" role="group" aria-label={tr('언어', 'Language')}>
            {LANGS.map(([v, label]) => (
              <button key={v} className={lang === v ? 'on' : ''} disabled={langBusy} onClick={() => changeMyLang(v)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="sect">
          <SectLab info={isSelf
            ? tr('부모님은 로그인할 필요가 없어요. 등록을 마치고 링크를 보내면, 부모님은 링크를 눌러 ‘연결하기’만 누르면 돼요. 목록의 ⋯에서 보기·삭제·빼기를 할 수 있어요.', 'Your parent never signs in. Finish registering, send them the link, and they only tap the link and then ‘Link’. The ⋯ on each row opens, removes or takes someone off the list.')
            : tr('휴대폰을 잃어버렸다면 바로 ‘연결 해제’를 눌러주세요. 가족을 초대하면 함께 볼 수 있고, 관리자는 설정을 바꿀 수 있어요.', 'If the phone is lost, tap ‘Unlink’ right away. Invite family and they can see it too; a manager can change the settings.')}>{tr('부모님', 'Parent')}</SectLab>
          {isSelf && (
            <button className="linkbtn" onClick={() => setRegistering(true)}>
              <span>{tr('부모님 등록하기', 'Register a parent')}</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
          {isSelf && people.length > 0 && (
            <>
              <div className="sub-lab">{tr('함께 보는 가족', 'Family who can see')}</div>
              {people.map((p) => {
                const mine = p.membership.role === 'guardian'
                return (
                  <div className="row" key={p.patientUid}>
                    <div className="who">
                      <b>{p.name}</b>
                      <span> · {mine ? tr('내가 등록한 부모님', 'The parent I registered') : p.membership.role === 'viewer' ? tr('뷰어', 'Viewer') : tr('관리자', 'Manager')}</span>
                      <ParentAppStatus patientUid={p.patientUid} patientName={p.name} canManage={p.membership.role !== 'viewer'} />
                    </div>
                    <button type="button" className="more-btn" aria-label={tr(`${honorific(p.name)} 더보기`, `More for ${honorific(p.name)}`)} aria-haspopup="dialog" onClick={() => setRowMenu({ kind: 'person', patientUid: p.patientUid, name: p.name, mine })}>⋯</button>
                  </div>
                )
              })}
            </>
          )}
          {isManaged && !isSelf && canManageHere && (
            <div ref={devicesRef} className="jump-target"><ElderDevices patientUid={activePatientUid} patientName={settings.patientName} /></div>
          )}
          {!isSelf && canManageHere && (
            <>
              {/* The parent's language: their screens, diary and place names (users/{parent}.geoLang). */}
              <div className="sub-lab">{tr('부모님 언어', "Parent's language")}</div>
              <div className="seg" role="group" aria-label={tr('부모님 언어', "Parent's language")}>
                {LANGS.map(([v, label]) => (
                  <button key={v} className={(settings.geoLang ?? 'ko') === v ? 'on' : ''} onClick={() => update('geoLang', v)}>{label}</button>
                ))}
              </div>
              <div className="help">{tr('부모님 화면과 사진 일기, 장소 이름을 이 언어로 적어요. 앞으로 찍는 사진부터 적용돼요.', "Your parent's screens, photo diary and place names use this language, from the next photo on.")}</div>
              {/* 메모 말투: how the worker's model words this parent's memos (memo v2). Family only.
                  English memos have one tone for now, so it is shown for Korean only. */}
              {(settings.geoLang ?? 'ko') === 'ko' && (
                <>
                  <div className="sub-lab">{tr('메모 말투', 'Memo tone')}</div>
                  <div className="seg" role="group" aria-label={tr('메모 말투', 'Memo tone')}>
                    {MEMO_STYLES.map(([v, label]) => (
                      <button key={v} className={(settings.memoStyle ?? 'warm') === v ? 'on' : ''} onClick={() => update('memoStyle', v)}>{label}</button>
                    ))}
                  </div>
                </>
              )}
              {/* 집 위치: where this parent lives, so trips read as trips. */}
              <HomePicker home={settings.home} patientUid={activePatientUid} onChange={(h) => update('home', h)} heading="sub" />
              <div className="sub-lab">{tr('함께 보는 가족', 'Family who can see')}</div>
              {caregivers.length === 0 ? (
                <div className="row"><div className="who"><span>{tr('아직 함께하는 가족이 없어요.', 'No family is sharing this yet.')}</span></div></div>
              ) : caregivers.map((m) => {
                const isMe = m.caregiverUid === user.uid
                const label = (m.caregiverName || (m.caregiverUid.slice(0, 6) + '…')) + (isMe ? tr(' (나)', ' (me)') : '')
                const statusLabel = m.status === 'invited' ? tr('초대됨', 'Invited') : m.status === 'active' ? tr('활성', 'Active') : tr('해제됨', 'Removed')
                const canSetRole = m.status === 'active' && m.role !== 'guardian' && !isMe
                const canRevoke = m.status !== 'revoked' && !isMe && m.role !== 'guardian'
                return (
                  <div className="row" key={m.id}>
                    <div className="who">
                      <b>{label}</b>
                      <span> · {m.role === 'guardian' ? tr('대표 가족', 'Main family member') : m.role === 'viewer' ? tr('뷰어', 'Viewer') : tr('관리자', 'Manager')} · {statusLabel}</span>
                    </div>
                    {(canSetRole || canRevoke) && (
                      <button type="button" className="more-btn" aria-label={tr(`${label} 더보기`, `More for ${label}`)} aria-haspopup="dialog" onClick={() => setRowMenu({ kind: 'member', caregiverUid: m.caregiverUid, label, role: m.role, canSetRole, canRevoke })}>⋯</button>
                    )}
                  </div>
                )
              })}
              <button className="linkbtn" onClick={openInvite}>
                <span>{tr('가족 초대하기', 'Invite family')}</span>
                <span aria-hidden="true">→</span>
              </button>
            </>
          )}
        </div>
        {registering && (
          <RegisterElder onClose={() => setRegistering(false)} onRegistered={onSwitchPatient} takenNames={people.map((p) => p.name)} />
        )}

        {isSelf && (
          <div className="sect">
            {/* 집 위치 for one's own photos: the same one address box as the parent's. */}
            <HomePicker home={settings.home} patientUid={activePatientUid} onChange={(h) => update('home', h)} />
          </div>
        )}

        {(pushRollout || (!isSelf && canManageHere)) && (
          <div className="sect">
            <SectLab>{tr('알림', 'Alerts')}</SectLab>
            {pushRollout && <PushToggle uid={user.uid} />}
            {!isSelf && canManageHere && (
              <>
                <SectLab info={tr('매일 이 시간에 오늘 사진 몇 장인지 알려드려요.', 'Every day at this time we tell you how many photos came in.')}>{tr('알림 시간', 'Time of the alert')}</SectLab>
                <div className="seg">
                  {noticeHourChoices(digest.hourLocal).map((h) => (
                    <button key={h} className={digest.hourLocal === h ? 'on' : ''} disabled={digestBusy} onClick={() => changeDigest({ hourLocal: h })}>
                      {noticeHourLabel(h)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* 요금제 in the payer's own settings: a plan belongs to one parent, so
            each parent this person manages gets a row that opens the sheet for them. */}
        {onOpenPlansFor && isSelf && (() => {
          const payable = people.filter((p) => p.membership.role === 'guardian' || p.membership.role === 'admin')
          return payable.length > 0 && (
            <div className="sect">
              <SectLab info={tr('가족이 함께 보는 방법과 사진을 보관하는 기간이 요금제마다 달라요.', 'How family see the photos together, and how long photos are kept, differ from plan to plan.')}>{tr('요금제', 'Plans')}</SectLab>
              {payable.map((p) => (
                <button key={p.patientUid} className="linkbtn" onClick={() => onOpenPlansFor(p.patientUid)}>
                  <span>{payable.length > 1 ? `${S.planTitle} · ${honorific(p.name)}` : S.planTitle}</span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )
        })()}

        {isSimple() && isSelf && lang !== 'en' && (
          <div className="sect">
            <ShareAppRow />
          </div>
        )}

        <div className="sect">
          <SectLab>{tr('도움말·약관', 'Help & terms')}</SectLab>
          {/* In this window, not a new tab: the page's own ‹ 설정으로 돌아가기 brings the app back here. */}
          <a className="linkbtn" href={`${PUBLIC_ORIGIN}${legalPath('privacy')}`}><span>{tr('개인정보처리방침', 'Privacy policy')}</span><span aria-hidden="true">→</span></a>
          <a className="linkbtn" href={`${PUBLIC_ORIGIN}${legalPath('terms')}`}><span>{tr('이용약관', 'Terms of use')}</span><span aria-hidden="true">→</span></a>
        </div>

        <div className="sect">
          <button className="linkbtn" onClick={() => setAsk({ title: tr('로그아웃할까요?', 'Sign out?'), label: tr('로그아웃', 'Sign out'), run: async () => { try { await onSignOut() } catch (e) { console.error(e); toast.show(tr('로그아웃에 실패했어요', "Couldn't sign out")) } } })}>
            <span>{tr('로그아웃', 'Sign out')}</span>
          </button>
        </div>

        {canDeleteMe && (
          <div className="sect">
            <SectLab info={tr('내 사진과 기록, 가족 연결이 모두 지워지고 되돌릴 수 없어요.', "Your photos, your records and your family links are all erased, and it can't be undone.")}>{tr('계정 삭제', 'Delete account')}</SectLab>
            <button type="button" className="quiet-link" onClick={() => setDeleteMeOpen(true)}>{tr('계정 삭제하기', 'Delete my account')}</button>
          </div>
        )}

        {rowMenu && (
          <BottomSheet onClose={() => setRowMenu(null)}>
            {rowMenu.kind === 'person' ? (
              <>
                <button type="button" className="sheet-item" onClick={() => { setRowMenu(null); onSwitchPatient(rowMenu.patientUid) }}>{tr(`${honorific(rowMenu.name)} 기록 보기`, `See ${honorific(rowMenu.name)}'s records`)}</button>
                {rowMenu.mine
                  ? <button type="button" className="sheet-item danger sep" onClick={() => { setRowMenu(null); setDeleteTarget({ patientUid: rowMenu.patientUid, name: rowMenu.name }) }}>{tr(`${honorific(rowMenu.name)} 삭제`, `Remove ${honorific(rowMenu.name)}`)}</button>
                  : <button type="button" className="sheet-item danger sep" onClick={() => { const { patientUid, name } = rowMenu; setRowMenu(null); setAsk({ title: tr(`${honorificWith(name, '를')} 내 목록에서 뺄까요?`, `Take ${honorific(name)} off my list?`), sub: tr(`${honorific(name)}의 사진과 기록은 그대로 남고, 나만 더 이상 볼 수 없게 돼요.`, `${honorific(name)}'s photos and records stay; only I stop seeing them.`), label: tr('빼기', 'Take off'), run: () => leaveQuietly(patientUid, name) }) }}>{tr('내 목록에서 빼기', 'Take off my list')}</button>}
              </>
            ) : (
              <>
                {rowMenu.canSetRole && (
                  <button type="button" className="sheet-item" onClick={() => { const { caregiverUid, role } = rowMenu; setRowMenu(null); void onSetRole(caregiverUid, role === 'admin' ? 'viewer' : 'admin') }}>
                    {rowMenu.role === 'admin' ? tr('뷰어로 바꾸기 (보기만)', 'Make a viewer (looks only)') : tr('관리자로 바꾸기 (편집 가능)', 'Make a manager (can edit)')}
                  </button>
                )}
                {rowMenu.canRevoke && (
                  <button type="button" className="sheet-item danger sep" onClick={() => { const { caregiverUid, label } = rowMenu; setRowMenu(null); setAsk({ title: tr(`${label}님의 접근을 해제할까요?`, `Remove ${label}'s access?`), label: tr('해제', 'Remove'), run: () => revokeQuietly(caregiverUid) }) }}>{tr('가족 접근 해제', 'Remove their access')}</button>
                )}
              </>
            )}
            <button type="button" className="sheet-cancel" onClick={() => setRowMenu(null)}>{tr('취소', 'Cancel')}</button>
          </BottomSheet>
        )}
        {ask && (
          <BottomSheet title={ask.title} onClose={() => { if (!askBusy) setAsk(null) }}>
            {ask.sub && <p className="sheet-sub">{ask.sub}</p>}
            <button type="button" className="sheet-danger-btn" disabled={askBusy} onClick={() => { void runAsk() }}>{askBusy ? tr('잠시만요…', 'One moment…') : ask.label}</button>
            <button type="button" className="sheet-cancel" disabled={askBusy} onClick={() => setAsk(null)}>{tr('취소', 'Cancel')}</button>
          </BottomSheet>
        )}
        {modals}
      </section>
    )
  }

  return (
    <section className="page">
      {/* Account — kept so the user can sign out / see which Google account
          is in use. Not in the visual prototype but functionally important. */}
      <div className="sect">
        <SectLab>{tr('계정', 'Account')}</SectLab>
        <div className="row">
          <div className="account-row" style={{ flex: 1 }}>
            {user.photoURL && <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
            <div className="account-info">
              <div className="name">{user.displayName || tr('이름 없음', 'No name')}</div>
              <div className="email">{user.email}</div>
            </div>
          </div>
          <button
            className="signout-btn"
            onClick={async () => {
              if (!confirm(tr('로그아웃할까요?', 'Sign out?'))) return
              try { await onSignOut() } catch (e) { console.error(e); toast.show(tr('로그아웃에 실패했어요', "Couldn't sign out")) }
            }}
          >{tr('로그아웃', 'Sign out')}</button>
        </div>
      </div>

      {isSelf && (
        <div className="sect">
          <SectLab info={tr('부모님은 로그인할 필요가 없어요. 여기서 설정을 마치고 링크를 보내면, 부모님은 링크를 눌러 ‘연결하기’만 누르면 돼요.', 'Your parent never signs in. Finish the settings here, send them the link, and they only tap the link and then ‘Link’.')}>{tr('부모님', 'Parent')}</SectLab>
          <button className="linkbtn" onClick={() => setRegistering(true)}>
            <span>{tr('부모님 등록하기', 'Register a parent')}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
      {registering && (
        <RegisterElder onClose={() => setRegistering(false)} onRegistered={onSwitchPatient} takenNames={people.map((p) => p.name)} />
      )}

      {isSelf && people.length > 0 && (
        <div className="sect">
          <SectLab info={tr('화면 위쪽에서 고르는 이름 목록과 같아요. ‘삭제’는 내가 등록한 부모님의 계정과 사진·기록을 모두 지워요. ‘✕’는 다른 가족이 등록한 분을 내 목록에서만 빼요.', 'The same list of names you pick from at the top. ‘Remove’ erases the account, photos and records of a parent I registered. ‘✕’ only takes someone another family member registered off my list.')}>{tr('함께 보는 가족', 'Family who can see')}</SectLab>
          {people.map((p) => {
            const mine = p.membership.role === 'guardian'
            return (
              <div className="row recipient-row" key={p.patientUid}>
                <div className="who">
                  <b>{p.name}</b>
                  <span> · {mine ? tr('내가 등록한 부모님', 'The parent I registered') : p.membership.role === 'viewer' ? tr('뷰어', 'Viewer') : tr('관리자', 'Manager')}</span>
                </div>
                <div className="send-row">
                  <button className="send-btn" onClick={() => onSwitchPatient(p.patientUid)}>{tr('보기', 'Open')}</button>
                  {mine
                    ? <button className="send-btn send-del" onClick={() => setDeleteTarget({ patientUid: p.patientUid, name: p.name })} aria-label={tr(`${honorific(p.name)} 삭제`, `Remove ${honorific(p.name)}`)} title={tr('삭제', 'Remove')}>{tr('삭제', 'Remove')}</button>
                    : <button className="send-btn send-del" onClick={() => onLeave(p.patientUid, p.name)} aria-label={tr(`${honorific(p.name)} 목록에서 빼기`, `Take ${honorific(p.name)} off my list`)} title={tr('빼기', 'Take off')}>✕</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {isManaged && !isSelf && canManageHere && (
        <div ref={devicesRef} className="jump-target"><ElderDevices patientUid={activePatientUid} patientName={settings.patientName} /></div>
      )}

      {familyPhotosRollout && isManaged && !isSelf && canManageHere && (() => {
        const fp = settings.familyPhotos ?? {}
        const enabled = fp.enabled !== false
        const senders = fp.senders === 'admins' ? 'admins' : 'all'
        return (
          <div className="sect">
            <SectLab info={!enabled ? tr(`${honorific(settings.patientName)} 휴대폰에 가족이 보낸 사진이 카드로 보여요. 사진을 보면 하트나 짧은 답장을 보낼 수 있어요.`, `Photos from family show as a card on ${honorific(settings.patientName)}'s phone. After looking, they can send a heart or a short reply.`) : senders === 'admins' ? tr('대표 가족과 관리자만 사진을 보낼 수 있어요.', 'Only the main family member and managers can send photos.') : tr('함께 보는 가족 모두 사진을 보낼 수 있어요. 한 사람이 하루 10장까지예요.', 'Everyone in the family can send photos, up to 10 a day each.')}>{tr('가족 사진', 'Family photos')}</SectLab>
            <div className="row">
              <div className="who"><b>{tr('가족이 보낸 사진 받기', 'Receive photos from family')}</b><br /><span>{tr(`${honorific(settings.patientName)} 휴대폰에 카드로 보여요. 사진을 보면 하트나 짧은 답장을 보낼 수 있어요.`, `They show as a card on ${honorific(settings.patientName)}'s phone. After looking, they can send a heart or a short reply.`)}</span></div>
              <button
                className={`switch ${enabled ? 'on' : ''}`}
                role="switch"
                aria-checked={enabled}
                onClick={() => update('familyPhotos', { ...fp, enabled: !enabled })}
                aria-label={tr('가족 사진 받기 전환', 'Toggle receiving family photos')}
              ><span className="knob" /></button>
            </div>
            {enabled && (
              <>
                <div className="seg">
                  <button className={senders === 'all' ? 'on' : ''} onClick={() => update('familyPhotos', { ...fp, senders: 'all' })}>{tr('모든 가족', 'All family')}</button>
                  <button className={senders === 'admins' ? 'on' : ''} onClick={() => update('familyPhotos', { ...fp, senders: 'admins' })}>{tr('관리자만', 'Managers only')}</button>
                </div>
              </>
            )}
          </div>
        )
      })()}

      <div className="sect">
        <SectLab>{tr('사용자 이름', 'Your name')}</SectLab>
        <div className="row">
          <div className="who"><b>{tr('표시되는 이름', 'The name shown')}</b><br /><span>{tr('가족 알림에 사용돼요', 'Used in the notices to family')}</span></div>
          <input
            value={settings.patientName}
            onChange={(e) => update('patientName', e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 16, background: '#fff', width: 130, textAlign: 'right', fontFamily: 'inherit' }}
          />
        </div>
      </div>

      {canManageHere && (
        <div className="sect">
          <HomePicker home={settings.home} patientUid={activePatientUid} onChange={(h) => update('home', h)} />
        </div>
      )}

      {canManageHere && (
        <div className="sect">
          <SectLab info={tr('사진을 찍은 장소와 주소를 이 언어로 적어요. 앞으로 찍는 사진부터 적용돼요.', 'The place a photo was taken and its address are written in this language, from the next photo on.')}>{tr('언어', 'Language')}</SectLab>
          <div className="seg">
            <button className={geoLang === 'ko' ? 'on' : ''} onClick={() => update('geoLang', 'ko')}>한국어</button>
            <button className={geoLang === 'en' ? 'on' : ''} onClick={() => update('geoLang', 'en')}>English</button>
          </div>
        </div>
      )}

      {/* Caregiver-share management. Only shown when viewing the SIGNED-IN
          user's own account — caregivers viewing someone else's account
          don't get to invite or revoke from the patient's perspective. */}
      {canManageHere && (
        <div className="sect">
          <SectLab info={tr('카카오톡이나 문자로 초대 링크를 보낼 수 있어요. 링크는 24시간 동안 유효해요. 관리자는 설정을 바꿀 수 있고, 뷰어는 보기만 해요.', 'You can send the invite link by KakaoTalk or text message. The link is good for 24 hours. A manager can change the settings; a viewer only looks.')}>{tr('가족 관리', 'Family')}</SectLab>
          {caregivers.length === 0 ? (
            <div className="row">
              <div className="who"><span>{tr('아직 함께하는 가족이 없어요.', 'No family is sharing this yet.')}</span></div>
            </div>
          ) : caregivers.map((m) => {
            const isMe = m.caregiverUid === user.uid
            const label = (m.caregiverName || (m.caregiverUid.slice(0, 6) + '…')) + (isMe ? tr(' (나)', ' (me)') : '')
            const statusLabel = m.status === 'invited' ? tr('초대됨', 'Invited') : m.status === 'active' ? tr('활성', 'Active') : tr('해제됨', 'Removed')
            const canSetRole = m.status === 'active' && m.role !== 'guardian' && !isMe
            return (
              <div className="cg-row" key={m.id}>
                <div className="row recipient-row">
                  <div className="who">
                    <b>{label}</b>
                    <span> · {m.role === 'guardian' ? tr('대표 가족 · ', 'Main family member · ') : ''}{statusLabel}</span>
                  </div>
                  <div className="send-row">
                    {m.status !== 'revoked' && !isMe && (m.role !== 'guardian' || isSelf) && (
                      <button
                        className="send-btn send-del"
                        onClick={() => onRevoke(m.caregiverUid, label)}
                        aria-label={tr('가족 접근 해제', 'Remove their access')}
                        title={tr('해제', 'Remove')}
                      >✕</button>
                    )}
                  </div>
                </div>
                {canSetRole && (
                  <div className="seg cg-role-seg">
                    <button
                      className={m.role === 'admin' ? 'on' : ''}
                      onClick={() => onSetRole(m.caregiverUid, 'admin')}
                    >{tr('관리자 (편집 가능)', 'Manager (can edit)')}</button>
                    <button
                      className={m.role === 'viewer' ? 'on' : ''}
                      onClick={() => onSetRole(m.caregiverUid, 'viewer')}
                    >{tr('뷰어 (보기만)', 'Viewer (looks only)')}</button>
                  </div>
                )}
              </div>
            )
          })}
          <button className="linkbtn" onClick={openInvite} style={{ marginTop: 8 }}>
            <span>{tr('가족초대', 'Invite family')}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      {onOpenPlans && (
        <div className="sect">
          <SectLab info={tr('가족이 함께 보는 방법과 사진을 보관하는 기간이 요금제마다 달라요.', 'How family see the photos together, and how long photos are kept, differ from plan to plan.')}>{tr('요금제', 'Plans')}</SectLab>
          <div className="row">
            <div className="who"><b>{S.planCurrent}</b><br /><span>{planName ?? ''}</span></div>
          </div>
          <button className="linkbtn" onClick={() => onOpenPlans({ kind: 'settings' })}>
            <span>{S.planTitle}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      {digestRollout && canManageHere && (
        <div className="sect">
          <SectLab info={tr(`${honorific(settings.patientName)}의 하루를 두세 문장으로 정리해 가족에게 보내요. 사진이 없는 날은 보내지 않아요. 받는 방법은 알림 탭에서 고를 수 있어요.`, `${honorific(settings.patientName)}'s day is gathered into two or three sentences and sent to the family. Nothing is sent on a day without photos. How you get it is chosen in the Alerts tab.`)}>{tr('하루 요약', 'Summary of the day')}</SectLab>
          <div className="seg">
            <button className={digest.cadence === 'daily' ? 'on' : ''} disabled={digestBusy} onClick={() => changeDigest({ cadence: 'daily' })}>{tr('매일 저녁', 'Every evening')}</button>
            <button className={digest.cadence === 'weekly' ? 'on' : ''} disabled={digestBusy || !weeklyIncluded} onClick={() => changeDigest({ cadence: 'weekly' })}>
              {tr('매주 일요일', 'Every Sunday')}{!weeklyIncluded && weeklyFrom && <> <span className="plan-chip">{tr(`${weeklyFrom} 이상`, `${weeklyFrom} and up`)}</span></>}
            </button>
          </div>
          <div className="row">
            <div className="who"><b>{tr('보내는 시간', 'When it is sent')}</b><br /><span>{tr(`${digest.tz === 'Asia/Seoul' ? '한국 시간' : digest.tz} 기준`, digest.tz === 'Asia/Seoul' ? 'Korea time' : digest.tz)}</span></div>
            <select
              className="dg-hour"
              value={digest.hourLocal}
              disabled={digestBusy}
              onChange={(e) => changeDigest({ hourLocal: Number(e.target.value) })}
              aria-label={tr('하루 요약을 보내는 시간', 'When the summary of the day is sent')}
            >
              {[...new Set([...DIGEST_HOURS, digest.hourLocal])].sort((a, b) => a - b).map((h) => (
                <option key={h} value={h}>{tr(h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`, h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`)}</option>
              ))}
            </select>
          </div>
          {deviceTz !== 'Asia/Seoul' && (
            <div className="seg" style={{ marginTop: 10 }}>
              <button className={digest.tz === 'Asia/Seoul' ? 'on' : ''} disabled={digestBusy} onClick={() => changeDigest({ tz: 'Asia/Seoul' })}>{tr('한국 시간', 'Korea time')}</button>
              <button className={digest.tz === deviceTz ? 'on' : ''} disabled={digestBusy} onClick={() => changeDigest({ tz: deviceTz })}>{tr('이 기기의 시간', "This phone's time")}</button>
            </div>
          )}
        </div>
      )}

      {!digestRollout && <div className="sect">
        <SectLab info={cadenceHint}>{tr('전송 시점', 'When to send')}</SectLab>
        <div className="seg">
          <button
            className={settings.cadence === 'realtime' ? 'on' : ''}
            onClick={() => update('cadence', 'realtime')}
          >{tr('실시간', 'Right away')}</button>
          <button
            className={settings.cadence === 'daily' ? 'on' : ''}
            onClick={() => update('cadence', 'daily')}
          >{tr('매일 저녁', 'Every evening')}</button>
          <button
            className={settings.cadence === 'weekly' ? 'on' : ''}
            onClick={() => update('cadence', 'weekly')}
          >{tr('매주', 'Every week')}</button>
        </div>
      </div>}

      <div className="sect">
        <SectLab info={tr('끄면 보내기 전에 가족이 한 번 확인할 수 있어요.', 'Turn it off and family can check each photo before it is sent.')}>{tr('자동 기록', 'Automatic records')}</SectLab>
        <div className="row">
          <div className="who"><b>{tr('자동으로 기록·전송', 'Record and send automatically')}</b><br /><span>{tr('사진을 찍으면 바로 기록하고 보냅니다', 'A photo is recorded and sent as soon as it is taken')}</span></div>
          <button
            className={`switch ${settings.autoMode ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.autoMode}
            onClick={() => update('autoMode', !settings.autoMode)}
            aria-label={tr('자동 기록 전환', 'Toggle automatic records')}
          ><span className="knob" /></button>
        </div>
      </div>

      {reactionsRollout && canManageHere && (
        <div className="sect">
          <SectLab info={textReplies === 'off' ? tr(`${honorificWith(settings.patientName, '는')} 하트${settings.voiceEnabled ? '와 목소리' : ''}로만 답해요.`, `${honorific(settings.patientName)} answers with a heart${settings.voiceEnabled ? ' or their voice' : ''} only.`)
              : textReplies === 'full' ? tr(`${honorificWith(settings.patientName, '가')} 직접 써서 답해요. “고마워” 같은 짧은 답장도 바로 아래에 있어요.`, `${honorific(settings.patientName)} writes their own answer. Short replies like “Thank you” are right underneath.`)
              : tr(`${honorificWith(settings.patientName, '가')} “고마워”, “밥 먹었어” 같은 짧은 답장을 한 번 눌러 보낼 수 있어요. 자판은 나오지 않아요.`, `${honorific(settings.patientName)} can send short replies like “Thank you” or “I ate” with one tap. No keyboard appears.`)}>{tr('글로 답장', 'Reply in writing')}</SectLab>
          <div className="seg">
            <button className={textReplies === 'off' ? 'on' : ''} onClick={() => update('textReplies', 'off')}>{tr('끄기', 'Off')}</button>
            <button className={textReplies === 'quick' ? 'on' : ''} onClick={() => update('textReplies', 'quick')}>{tr('짧은 답장만', 'Short replies only')}</button>
            <button className={textReplies === 'full' ? 'on' : ''} onClick={() => update('textReplies', 'full')}>{tr('직접 쓰기', 'Write their own')}</button>
          </div>
        </div>
      )}

      {voiceRollout && canManageHere && (
        <div className="sect">
          <SectLab info={tr(`처음 말할 때 ${honorific(settings.patientName)} 휴대폰이 마이크 사용을 한 번 물어봐요.`, `The first time they speak, ${honorific(settings.patientName)}'s phone asks once to use the microphone.`)}>{tr('음성 답장', 'Voice replies')}</SectLab>
          <div className="row">
            <div className="who"><b>{tr('목소리로 답장 받기', 'Get replies by voice')}</b><br /><span>{tr(`${honorificWith(settings.patientName, '가')} 버튼을 꾹 누르고 말하면 가족에게 전해져요`, `${honorific(settings.patientName)} presses and holds the button to speak, and family hear it`)}</span></div>
            <button
              className={`switch ${settings.voiceEnabled ? 'on' : ''}`}
              role="switch"
              aria-checked={!!settings.voiceEnabled}
              onClick={() => (settings.voiceEnabled ? update('voiceEnabled', false) : setVoiceOpen(true))}
              aria-label={tr('음성 답장 전환', 'Toggle voice replies')}
            ><span className="knob" /></button>
          </div>
        </div>
      )}

      {/* Simple edition: 알림 — the 앱 알림 switch (this device + the account),
          and for a parent when the daily "오늘 엄마님의 사진 n장" notice comes
          (worker/src/handlers/dailyNotice.ts reads digest.hourLocal). */}
      {simple && (pushRollout || (!isSelf && canManageHere)) && (
        <div className="sect">
          <SectLab>{tr('알림', 'Alerts')}</SectLab>
          {pushRollout && <PushToggle uid={user.uid} />}
          {!isSelf && canManageHere && (
            <>
              <SectLab info={tr('매일 이 시간에 오늘 사진 몇 장인지 알려드려요.', 'Every day at this time we tell you how many photos came in.')}>{tr('알림 시간', 'Time of the alert')}</SectLab>
              <div className="seg">
                {noticeHourChoices(digest.hourLocal).map((h) => (
                  <button key={h} className={digest.hourLocal === h ? 'on' : ''} disabled={digestBusy} onClick={() => changeDigest({ hourLocal: h })}>
                    {noticeHourLabel(h)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="sect">
        <SectLab>{tr('글자 크기', 'Text size')}</SectLab>
        <div className="seg">
          <button
            className={!settings.bigText ? 'on' : ''}
            onClick={() => update('bigText', false)}
          >{tr('보통', 'Normal')}</button>
          <button
            className={settings.bigText ? 'on' : ''}
            onClick={() => update('bigText', true)}
          >{tr('크게', 'Large')}</button>
        </div>
      </div>

      {!onOpenPlans && <div className="sect">
        <SectLab info={tr('기간이 지난 사진은 자동 삭제됩니다.', 'Photos past that time are deleted automatically.')}>{tr('사진 보관', 'Keep photos')}</SectLab>
        <div className="seg">
          <button
            className={settings.retention === '30' ? 'on' : ''}
            onClick={() => update('retention', '30')}
          >{tr('30일', '30 days')}</button>
          <button
            className={settings.retention === '90' ? 'on' : ''}
            onClick={() => update('retention', '90')}
          >{tr('90일', '90 days')}</button>
          <button
            className={settings.retention === 'forever' ? 'on' : ''}
            onClick={() => update('retention', 'forever')}
          >{tr('계속', 'Forever')}</button>
        </div>
      </div>}

      {!simple && <div className="proto-note">
        <b>{tr('Phase 1 안내.', 'Phase 1 note.')}</b> {tr('사진은 Firebase Cloud Storage에 저장되고, 메모는 Firestore에 기록됩니다. 카카오톡 발송은 Phase 2에 추가됩니다.', 'Photos are stored in Firebase Cloud Storage and memos are written to Firestore. Sending by KakaoTalk comes in Phase 2.')}
      </div>}

      {/* 가족초대 modal — two steps in one overlay.
          Step 1 (confirm): one consent screen. Tapping "동의하고 초대하기"
          has the worker write both consents + the invite + audit log in one
          batch.
          Step 2 (send): KakaoTalk or text message — nothing else. */}
      {isGuardian && (
        <div className="sect">
          <SectLab info={tr('잘못 등록했거나 더 이상 쓰지 않을 때만 사용하세요. 사진과 기록이 모두 지워지고 되돌릴 수 없어요.', "Use this only if you registered by mistake or no longer use it. All photos and records are erased and it can't be undone.")}>{tr('부모님 삭제', 'Remove parent')}</SectLab>
          <button className="linkbtn danger-btn" onClick={() => setDeleteTarget({ patientUid: activePatientUid, name: settings.patientName })}>
            <span>{tr(`${honorific(settings.patientName)} 삭제하기`, `Remove ${honorific(settings.patientName)}`)}</span>
          </button>
        </div>
      )}
      {canDeleteMe && (
        <div className="sect">
          <SectLab info={tr('내 사진과 기록, 가족 연결이 모두 지워지고 되돌릴 수 없어요.', "Your photos, your records and your family links are all erased, and it can't be undone.")}>{tr('계정 삭제', 'Delete account')}</SectLab>
          <button className="linkbtn danger-btn" onClick={() => setDeleteMeOpen(true)}>
            <span>{tr('계정 삭제하기', 'Delete my account')}</span>
          </button>
        </div>
      )}
      {isSimple() && <LegalLinks />}
      {modals}
    </section>
  )
}
