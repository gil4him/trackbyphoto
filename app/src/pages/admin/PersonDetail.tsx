// One person: account and login facts, settings, family links, phones,
// plan and its payment trail, the audit log — and the actions on them.

import { useCallback, useEffect, useState } from 'react'
import {
  ROLE_KO, PROVIDER_KO, actionLabel, confirmTyped, fmtWhen, fmtAgo, summarize,
  adminDeleteAccount, adminGetPerson, adminSetDisabled, adminSetMembership, adminSetPlan, adminUnlinkDevice, adminUpdateSettings,
  type AdminPersonDetail, type EditableSettings,
} from '../../lib/admin'
import { TIERS, TIER_NAME } from '../../lib/plan'
import { WorkerError } from '../../lib/worker'
import type { PlanTier } from '../../types'
import { Badge, Empty, Flags, KindBadge, Section } from './ui'

const ROLES = ['guardian', 'admin', 'viewer'] as const
const CADENCE_KO = { realtime: '바로', daily: '하루 한 번', weekly: '주 1회' } as const
const RETENTION_KO = { '30': '30일', '90': '90일', forever: '계속' } as const
const TEXT_REPLIES_KO = { full: '직접 입력 + 문구', quick: '문구만', off: '끔' } as const
const CONSENT_KO: Record<string, string> = { sensitive_data: '민감정보 처리', third_party_share: '제3자 제공', notice_ack: '안내 확인', voice_reply: '음성 답장' }

export function PersonDetail({ uid, onBack, onOpen, onChanged }: {
  uid: string
  onBack: () => void
  onOpen: (uid: string) => void
  /** After any write — the list on the other tabs is stale. */
  onChanged: () => void
}) {
  const [person, setPerson] = useState<AdminPersonDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [gone, setGone] = useState(false)

  // The shell keys this component by uid, so state starts fresh per person;
  // this only fetches.
  const load = useCallback(() =>
    adminGetPerson(uid).then(
      (p) => { setPerson(p); setError(null) },
      (err) => { console.error('[admin] person', err); setError(describe(err)) },
    ), [uid])

  useEffect(() => { void load() }, [load])

  /** Run one action, then reload this page and tell the shell to reload the list. */
  const run = async (key: string, work: () => Promise<unknown>, after: 'reload' | 'gone' = 'reload') => {
    setBusy(key)
    setError(null)
    try {
      await work()
      onChanged()
      if (after === 'gone') setGone(true)
      else await load()
    } catch (err) {
      console.error('[admin]', key, err)
      setError(describe(err))
    } finally {
      setBusy(null)
    }
  }

  if (gone) {
    return (
      <div className="admin-detail">
        <button type="button" className="admin-back" onClick={onBack}>← 목록</button>
        <Empty>계정이 삭제되었어요.</Empty>
      </div>
    )
  }

  if (!person) {
    return (
      <div className="admin-detail">
        <button type="button" className="admin-back" onClick={onBack}>← 목록</button>
        {error ? <div className="admin-error">{error}</div> : <Empty>불러오는 중…</Empty>}
      </div>
    )
  }

  const p = person
  const isParent = p.kind === 'parent'
  const s = (p.settings ?? {}) as Record<string, unknown>
  const activeLinks = p.linkList.filter((l) => l.status === 'active')
  const pastLinks = p.linkList.filter((l) => l.status !== 'active')

  return (
    <div className="admin-detail">
      <button type="button" className="admin-back" onClick={onBack}>← 목록</button>

      <header className="admin-detail-head">
        <div>
          <div className="admin-detail-title">
            <KindBadge kind={p.kind} />
            <h1>{p.name}</h1>
            <Flags person={p} />
          </div>
          <div className="muted admin-detail-sub">
            {p.email ?? '이메일 없음 (휴대폰 연결 계정)'} · <code>{p.uid}</code>
          </div>
        </div>
      </header>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-detail-grid">
        <Section title="계정 · 로그인">
          <dl className="admin-dl">
            <dt>로그인 방식</dt><dd>{p.providers.length ? p.providers.map((v) => PROVIDER_KO[v] ?? v).join(', ') : (isParent ? '연결 코드 (가족이 등록)' : '—')}</dd>
            <dt>가입</dt><dd>{fmtWhen(p.createdAt)}</dd>
            <dt>마지막 로그인</dt><dd>{fmtWhen(p.lastSignInAt)} <span className="muted">({fmtAgo(p.lastSignInAt)})</span></dd>
            <dt>마지막 활동</dt><dd>{fmtWhen(p.lastRefreshAt)} <span className="muted">(토큰 갱신)</span></dd>
            <dt>상태</dt>
            <dd>
              {p.disabled ? <Badge tone="bad">로그인 차단됨</Badge> : <Badge tone="good">정상</Badge>}
              {!p.isAdmin && (
                <button type="button" className="admin-btn small" disabled={busy !== null}
                  onClick={() => {
                    if (!p.disabled && !confirm(`${p.name} 계정의 로그인을 차단할까요? 현재 로그인도 끊깁니다.`)) return
                    void run('disable', () => adminSetDisabled(p.uid, !p.disabled))
                  }}>
                  {busy === 'disable' ? '처리 중…' : p.disabled ? '차단 해제' : '로그인 차단'}
                </button>
              )}
            </dd>
            <dt>기록</dt>
            <dd>사진 {p.memos.count.toLocaleString('ko-KR')}장 (마지막 {fmtAgo(p.memos.lastAt)}) · 반응 {p.counts.reactions} · 가족 사진 {p.counts.familyPhotos} · 알림 {p.counts.notifications}</dd>
          </dl>
        </Section>

        <Section title="설정">
          {p.settings ? (
            <SettingsEditor
              person={p}
              busy={busy === 'settings'}
              onSave={(patch) => run('settings', () => adminUpdateSettings(p.uid, patch))}
            />
          ) : <Empty>아직 설정을 저장한 적이 없어요.</Empty>}
        </Section>
      </div>

      <Section title={isParent ? '가족' : '돌보는 부모님'} aside={<span className="muted">{activeLinks.length}명</span>}>
        {p.linkList.length === 0 ? <Empty>연결된 사람이 없어요.</Empty> : (
          <table className="admin-table">
            <thead>
              <tr><th>{isParent ? '가족' : '부모님'}</th><th>역할</th><th>상태</th><th>연결</th><th></th></tr>
            </thead>
            <tbody>
              {[...activeLinks, ...pastLinks].map((l) => {
                const otherUid = isParent ? l.caregiverUid : l.patientUid
                const key = `link:${l.id}`
                const canEdit = l.status === 'active'
                return (
                  <tr key={l.id} className={l.status !== 'active' ? 'admin-row-dim' : undefined}>
                    <td>
                      <button type="button" className="admin-linkbtn" onClick={() => onOpen(otherUid)}>{l.otherName}</button>
                      {l.otherEmail && <div className="admin-cell-sub">{l.otherEmail}</div>}
                    </td>
                    <td>
                      {canEdit ? (
                        <select className="admin-select small" value={l.role} disabled={busy !== null}
                          onChange={(e) => {
                            const role = e.target.value
                            void run(key, () => adminSetMembership(l.patientUid, l.caregiverUid, { role }).catch((err) =>
                              rescueOnlyGuardian(err, () => adminSetMembership(l.patientUid, l.caregiverUid, { role }, true))))
                          }}>
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_KO[r]}</option>)}
                        </select>
                      ) : (ROLE_KO[l.role] ?? l.role)}
                    </td>
                    <td>{l.status === 'active' ? <Badge tone="good">활성</Badge> : l.status === 'revoked' ? <Badge tone="bad">해제됨</Badge> : <Badge tone="warn">{l.status}</Badge>}</td>
                    <td className="muted nowrap" title={l.acceptedAt ?? l.createdAt ?? ''}>
                      {fmtAgo(l.acceptedAt ?? l.createdAt)}{l.revokedAt && ` · 해제 ${fmtAgo(l.revokedAt)}`}
                    </td>
                    <td>
                      {canEdit && (
                        <button type="button" className="admin-btn small danger" disabled={busy !== null}
                          onClick={() => {
                            if (!confirm(`${l.otherName}의 접근을 해제할까요?`)) return
                            void run(key, () => adminSetMembership(l.patientUid, l.caregiverUid, { revoke: true }).catch((err) =>
                              rescueOnlyGuardian(err, () => adminSetMembership(l.patientUid, l.caregiverUid, { revoke: true }, true))))
                          }}>
                          {busy === key ? '…' : '해제'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      {isParent && (
        <Section title="휴대폰" aside={<span className="muted">연결 {p.devices.active}대</span>}>
          {p.deviceList.length === 0 ? <Empty>연결된 휴대폰이 없어요.</Empty> : (
            <table className="admin-table">
              <thead><tr><th>기기</th><th>연결</th><th>상태</th><th></th></tr></thead>
              <tbody>
                {p.deviceList.map((d) => (
                  <tr key={d.id} className={d.status !== 'active' ? 'admin-row-dim' : undefined}>
                    <td>{d.name} <span className="muted">{d.platform}{d.pairedVia ? ` · ${d.pairedVia}` : ''}</span></td>
                    <td className="muted nowrap">{fmtWhen(d.pairedAt)}</td>
                    <td>{d.status === 'active' ? <Badge tone="good">연결됨</Badge> : <Badge tone="bad">해제됨 {fmtAgo(d.revokedAt)}</Badge>}</td>
                    <td>
                      {d.status === 'active' && (
                        <button type="button" className="admin-btn small danger" disabled={busy !== null}
                          onClick={() => {
                            if (!confirm(`${d.name} 연결을 해제할까요? 그 휴대폰은 바로 사진을 보낼 수 없게 돼요.`)) return
                            void run(`device:${d.id}`, () => adminUnlinkDevice(p.uid, d.id))
                          }}>
                          {busy === `device:${d.id}` ? '…' : '연결 해제'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.pairings.length > 0 && (
            <details className="admin-more">
              <summary className="muted">연결 코드 기록 {p.pairings.length}건</summary>
              <table className="admin-table">
                <thead><tr><th>발급</th><th>용도</th><th>방식</th><th>상태</th><th>만료</th></tr></thead>
                <tbody>
                  {p.pairings.map((c) => (
                    <tr key={c.id}>
                      <td className="nowrap">{fmtWhen(c.createdAt)}</td>
                      <td>{c.purpose === 'repair' ? '재연결' : '첫 연결'}</td>
                      <td>{c.mode === 'qr' ? 'QR' : '링크'}</td>
                      <td>{c.status}</td>
                      <td className="nowrap">{fmtWhen(c.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </Section>
      )}

      <Section title="요금제 · 결제">
        <div className="admin-plan-row">
          <div>
            <div className="admin-plan-tier">{TIER_NAME[p.plan.tier]}</div>
            <div className="muted">
              {p.plan.explicit
                ? <>{p.plan.status ?? ''} · {fmtWhen(p.plan.since)}부터{typeof s.plan === 'object' && s.plan && (s.plan as { payment?: { provider?: string } }).payment?.provider ? ` · 결제: ${(s.plan as { payment: { provider: string } }).payment.provider}` : ''}</>
                : '요금제를 정한 적이 없어요 (Free)'}
            </div>
          </div>
          {p.settings && (
            <select className="admin-select" value={p.plan.tier} disabled={busy !== null}
              onChange={(e) => {
                const tier = e.target.value as PlanTier
                if (!confirm(`${p.name}을(를) ${TIER_NAME[tier]} 요금제로 바꿀까요? (결제 없이 관리자 변경)`)) return
                void run('plan', () => adminSetPlan(p.uid, tier))
              }}>
              {TIERS.map((t) => <option key={t} value={t}>{TIER_NAME[t]}</option>)}
            </select>
          )}
        </div>
        {p.planHistory.length > 0 && (
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>시각</th><th>변경</th><th>결제</th><th>변경한 사람</th><th>경로</th></tr></thead>
            <tbody>
              {p.planHistory.map((r) => {
                const d = r.details as { from?: string; to?: string; provider?: string; source?: string }
                return (
                  <tr key={r.id}>
                    <td className="nowrap">{fmtWhen(r.timestamp)}</td>
                    <td>{TIER_NAME[(d.from ?? 'free') as PlanTier] ?? d.from} → <b>{TIER_NAME[(d.to ?? 'free') as PlanTier] ?? d.to}</b></td>
                    <td>{d.provider === 'admin' ? '관리자' : d.provider === 'stub' ? '결제 없음 (테스트)' : d.provider ?? '—'}</td>
                    <td><button type="button" className="admin-linkbtn" onClick={() => onOpen(r.actorUid)}>{r.actorUid === p.uid ? '본인' : r.actorUid.slice(0, 8) + '…'}</button></td>
                    <td className="muted">{d.source ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      {p.consents.length > 0 && (
        <Section title="동의">
          <table className="admin-table">
            <thead><tr><th>종류</th><th>동의한 사람</th><th>문구 버전</th><th>시각</th></tr></thead>
            <tbody>
              {p.consents.map((c) => (
                <tr key={c.id}>
                  <td>{CONSENT_KO[c.type] ?? c.type}</td>
                  <td>{c.grantedBy === 'self' ? '본인' : c.guardianUid
                    ? <button type="button" className="admin-linkbtn" onClick={() => onOpen(c.guardianUid!)}>대표 가족</button>
                    : '가족'}</td>
                  <td className="muted">{c.consentTextVersion}</td>
                  <td className="nowrap">{fmtWhen(c.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="최근 활동" aside={<span className="muted">최근 {p.audit.length}건</span>}>
        {p.audit.length === 0 ? <Empty>기록이 없어요.</Empty> : (
          <table className="admin-table">
            <thead><tr><th>시각</th><th>작업</th><th>누가</th><th>내용</th></tr></thead>
            <tbody>
              {p.audit.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtWhen(r.timestamp)}</td>
                  <td className="nowrap">{actionLabel(r.action)}{r.patientUid !== p.uid && <span className="muted"> (다른 계정에서)</span>}</td>
                  <td>
                    {r.actorUid === p.uid ? '본인'
                      : <button type="button" className="admin-linkbtn" onClick={() => onOpen(r.actorUid)}>{r.actorUid.slice(0, 8)}…</button>}
                  </td>
                  <td className="muted admin-details">{summarize(r.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {!p.isAdmin && (
        <Section title="위험 구역">
          <div className="admin-danger">
            <div>
              <b>계정 삭제</b>
              <div className="muted">
                {isParent
                  ? '사진, 기록, 동의, 가족 연결, 휴대폰 연결이 모두 지워져요. 되돌릴 수 없어요.'
                  : '본인 기록과 설정, 부모님 기록에 남긴 반응·사진이 지워져요. 돌보던 부모님 계정은 남아요.'}
              </div>
            </div>
            <button type="button" className="admin-btn danger" disabled={busy !== null}
              onClick={() => {
                if (!confirmTyped(`${p.name} 계정을 완전히 삭제합니다.`, p.name)) return
                void run('delete', () => adminDeleteAccount(p.uid), 'gone')
              }}>
              {busy === 'delete' ? '삭제 중…' : '계정 삭제'}
            </button>
          </div>
        </Section>
      )}
    </div>
  )
}

/** The only-guardian refusal: ask, then retry with force. Any other error re-throws. */
async function rescueOnlyGuardian(err: unknown, retry: () => Promise<unknown>): Promise<unknown> {
  if (err instanceof WorkerError && err.code === 'failed-precondition' && /only guardian/.test(err.message)) {
    if (confirm('이 사람이 유일한 대표 가족이에요. 그래도 바꿀까요? (부모님을 관리할 사람이 없어져요)')) return retry()
    return
  }
  throw err
}

function describe(err: unknown): string {
  if (err instanceof WorkerError) return `${err.message} (${err.code})`
  return (err as Error)?.message ?? String(err)
}

function SettingsEditor({ person, busy, onSave }: {
  person: AdminPersonDetail
  busy: boolean
  onSave: (patch: EditableSettings) => void
}) {
  const s = (person.settings ?? {}) as Record<string, unknown>
  const isParent = person.kind === 'parent'
  const [name, setName] = useState(String(s.patientName ?? ''))
  const [cadence, setCadence] = useState(String(s.cadence ?? 'daily'))
  const [retention, setRetention] = useState(String(s.retention ?? '90'))
  const [bigText, setBigText] = useState(s.bigText !== false)
  const [geoLang, setGeoLang] = useState(String(s.geoLang ?? 'ko'))
  const [voiceEnabled, setVoiceEnabled] = useState(s.voiceEnabled === true)
  const [textReplies, setTextReplies] = useState(String(s.textReplies ?? 'full'))

  const patch: EditableSettings = {}
  if (name.trim() && name.trim() !== s.patientName) patch.patientName = name.trim()
  if (isParent) {
    if (cadence !== (s.cadence ?? 'daily')) patch.cadence = cadence as EditableSettings['cadence']
    if (retention !== (s.retention ?? '90')) patch.retention = retention as EditableSettings['retention']
    if (bigText !== (s.bigText !== false)) patch.bigText = bigText
    if (geoLang !== (s.geoLang ?? 'ko')) patch.geoLang = geoLang as EditableSettings['geoLang']
    if (voiceEnabled !== (s.voiceEnabled === true)) patch.voiceEnabled = voiceEnabled
    if (textReplies !== (s.textReplies ?? 'full')) patch.textReplies = textReplies as EditableSettings['textReplies']
  }
  const dirty = Object.keys(patch).length > 0

  return (
    <form className="admin-form" onSubmit={(e) => { e.preventDefault(); if (dirty) onSave(patch) }}>
      <label>이름<input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></label>
      {isParent && (
        <>
          <label>알림 주기
            <select value={cadence} onChange={(e) => setCadence(e.target.value)}>
              {Object.entries(CADENCE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>보관 기간
            <select value={retention} onChange={(e) => setRetention(e.target.value)}>
              {Object.entries(RETENTION_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>장소 이름 언어
            <select value={geoLang} onChange={(e) => setGeoLang(e.target.value)}>
              <option value="ko">한국어</option><option value="en">English</option>
            </select>
          </label>
          <label>글 답장
            <select value={textReplies} onChange={(e) => setTextReplies(e.target.value)}>
              {Object.entries(TEXT_REPLIES_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="admin-check"><input type="checkbox" checked={bigText} onChange={(e) => setBigText(e.target.checked)} />큰 글자</label>
          <label className="admin-check"><input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} />음성 답장</label>
        </>
      )}
      <div className="admin-form-foot">
        {typeof s.lastModifiedAt === 'string' && <span className="muted">마지막 변경 {fmtAgo(s.lastModifiedAt)}</span>}
        <button type="submit" className="admin-btn" disabled={!dirty || busy}>{busy ? '저장 중…' : '저장'}</button>
      </div>
    </form>
  )
}
