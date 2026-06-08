import { useState } from 'react'
import type { User } from 'firebase/auth'
import type { UserSettings } from '../types'
import { useToast } from '../components/Toast'

interface Props {
  settings: UserSettings
  onChange: (next: UserSettings) => void
  user: User
  onSignOut: () => Promise<void>
}

export function Settings({ settings, onChange, user, onSignOut }: Props) {
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const toast = useToast()

  const update = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) => onChange({ ...settings, [k]: v })

  const addRecipient = () => {
    if (!newName.trim() || !newPhone.trim()) {
      toast.show('이름과 전화번호를 모두 입력하세요')
      return
    }
    update('recipients', [...settings.recipients, { name: newName.trim(), phone: newPhone.trim() }])
    setNewName(''); setNewPhone('')
    toast.show('받을 사람이 추가되었어요')
  }

  const removeRecipient = (i: number) =>
    update('recipients', settings.recipients.filter((_, idx) => idx !== i))

  const cadenceHint = settings.cadence === 'realtime'
    ? '사진을 찍을 때마다 바로 보내요'
    : settings.cadence === 'weekly'
      ? '매주 한 번 요약을 보내요'
      : '매일 저녁 한 번 요약을 보내요'

  return (
    <section className="page active">
      <h2 style={{ margin: '6px 0 14px', fontSize: 24, letterSpacing: '-0.02em' }}>내 정보</h2>

      <div className="group">
        <h3>계정</h3>
        <div className="account-row">
          {user.photoURL && <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
          <div className="account-info">
            <div className="name">{user.displayName || '이름 없음'}</div>
            <div className="email">{user.email}</div>
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

      <div className="group">
        <h3>환자 이름</h3>
        <div className="row">
          <div className="label">표시되는 이름</div>
          <input
            value={settings.patientName}
            onChange={(e) => update('patientName', e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', fontSize: 15, background: '#FAF6EC', width: 140, textAlign: 'right' }}
          />
        </div>
      </div>

      <div className="group">
        <h3>받을 사람</h3>
        <div className="recipients">
          {settings.recipients.length === 0 ? (
            <div className="recipient"><div className="ph">아직 받을 사람이 없어요.</div></div>
          ) : settings.recipients.map((r, i) => (
            <div className="recipient" key={i}>
              <div>
                <div className="name">{r.name}</div>
                <div className="ph">{r.phone}</div>
              </div>
              <button className="del" onClick={() => removeRecipient(i)}>삭제</button>
            </div>
          ))}
        </div>
        <div className="add-recipient">
          <input placeholder="이름"          value={newName}  onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="010-0000-0000" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} inputMode="tel" />
          <button onClick={addRecipient}>추가</button>
        </div>
      </div>

      <div className="group">
        <h3>알림 빈도</h3>
        <div className="row">
          <div className="label">
            카카오톡 보내기
            <small>{cadenceHint}</small>
          </div>
          <Seg value={settings.cadence} options={[
            { v: 'realtime', label: '실시간' },
            { v: 'daily',    label: '매일' },
            { v: 'weekly',   label: '매주' },
          ]} onChange={(v) => update('cadence', v as UserSettings['cadence'])} />
        </div>
      </div>

      <div className="group">
        <h3>자동화</h3>
        <Toggle label="완전 자동" sub="찍자마자 저장 · 알림 전송 (기본 권장)"
          on={settings.autoMode} onChange={(v) => update('autoMode', v)} />
        <Toggle label="큰 글씨 모드" sub="어르신이 쓰시기 편하도록"
          on={settings.bigText} onChange={(v) => update('bigText', v)} />
      </div>

      <div className="group">
        <h3>보관</h3>
        <div className="row">
          <div className="label">
            사진 보관 기간
            <small>기간 지난 사진은 자동 삭제됩니다</small>
          </div>
          <Seg value={settings.retention} options={[
            { v: '30',      label: '30일' },
            { v: '90',      label: '90일' },
            { v: 'forever', label: '계속' },
          ]} onChange={(v) => update('retention', v as UserSettings['retention'])} />
        </div>
      </div>

      <div className="proto-note">
        <b>Phase 1 안내.</b> 사진은 Firebase Cloud Storage에 저장되고, 메모는 Firestore에 기록됩니다.
        AI 활동 설명과 장소명은 현재 데모용 자동 생성으로, Phase 2에서 Gemini Vision + Kakao Local API로 교체될 예정입니다.
        카카오톡 발송도 Phase 2에 추가됩니다.
      </div>
    </section>
  )
}

function Seg({ value, options, onChange }: {
  value: string
  options: { v: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, sub, on, onChange }: {
  label: string; sub?: string; on: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="row">
      <div className="label">
        {label}
        {sub && <small>{sub}</small>}
      </div>
      <div
        className={`switch ${on ? 'on' : ''}`}
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
      />
    </div>
  )
}
