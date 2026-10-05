import { useEffect, useState } from 'react'
import { useToast } from './Toast'
import { PAYMENTS_LIVE } from '../lib/payments'
import {
  TIERS, TIER_NAME, daysUntilOldestGoes, keptFor, offered, planLines, reasonLine, shortensKeeping, suggestedTier,
  type Memory, type PlanReason,
} from '../lib/plan'
import { changePlan, countPhotosBefore, loadMemory } from '../lib/planApi'
import { S } from '../lib/strings'
import { isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import type { Plans, PlanTier } from '../types'

const TIER_TO: Record<PlanTier, string> = { free: 'Free로', basic: 'Basic으로', plus: 'Plus로', family: 'Family로' }
const TIER_TOPIC: Record<PlanTier, string> = { free: 'Free는', basic: 'Basic은', plus: 'Plus는', family: 'Family는' }
const DAY_MS = 24 * 3600 * 1000

/**
 * One card for each plan in admin_config/plans. They say what a plan gives
 * the family; nothing here counts photos.
 */
export function PlanCards({ plans, current, patientName, suggested, canChange, busy, onChoose }: {
  plans: Plans
  current: PlanTier
  patientName: string
  /** The plan this visit points at (추천). */
  suggested?: PlanTier | null
  /** The viewer manages this parent's records; others only look. */
  canChange: boolean
  /** The plan being changed to right now. */
  busy?: PlanTier | null
  onChoose: (tier: PlanTier) => void
}) {
  return (
    <div className="plan-cards">
      {offered(plans).map((t) => {
        const ent = plans[t]!
        const isCurrent = t === current
        const up = TIERS.indexOf(t) > TIERS.indexOf(current)
        return (
          <div key={t} className={`plan-card${isCurrent ? ' current' : ''}${t === suggested ? ' suggested' : ''}`}>
            <div className="plan-head">
              <b className="plan-name">{TIER_NAME[t]}</b>
              {ent.priceLabel && <span className="plan-price">{ent.priceLabel}</span>}
              {isCurrent ? <span className="plan-chip">{S.planCurrent}</span> : t === suggested ? <span className="plan-chip rec">추천</span> : null}
            </div>
            <div className="plan-lines">{planLines(ent, patientName, plans.flags).join(' · ')}</div>
            {canChange && !isCurrent && (
              <button type="button" className="plan-go" disabled={busy != null} onClick={() => onChoose(t)}>
                {busy === t ? '바꾸는 중…' : up ? `${TIER_NAME[t]} 시작하기${ent.priceLabel ? ` ${ent.priceLabel}` : ''}` : `${TIER_TO[t]} 바꾸기`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Asked before a change that would let kept photos go. */
export interface KeepingConfirm {
  tier: PlanTier
  /** Photos older than the new plan keeps; null when they couldn't be counted. */
  count: number | null
}

/** The sheet itself, without its data loading (so it can be rendered in tests). */
export function PlanSheetView({ plans, patientName, current, hasPlanSinceMs, reason, canChange, memory, nowMs, busy, confirm, onChoose, onConfirm, onCancelConfirm, onClose }: {
  plans: Plans
  patientName: string
  current: PlanTier
  /** When the parent was put on a plan; null when it has no date, undefined when nobody has. */
  hasPlanSinceMs: number | null | undefined
  reason: PlanReason
  canChange: boolean
  memory: Memory | null
  nowMs: number
  busy: PlanTier | null
  confirm: KeepingConfirm | null
  onChoose: (tier: PlanTier) => void
  onConfirm: () => void
  onCancelConfirm: () => void
  onClose: () => void
}) {
  const suggested = suggestedTier(plans, current, reason)
  const why = reasonLine(reason, patientName, suggested)
  const days = memory && daysUntilOldestGoes({
    memory,
    retentionDays: plans[current]?.retentionDays ?? null,
    retentionOn: plans.flags?.retentionJob === true,
    planSinceMs: hasPlanSinceMs,
    nowMs,
  })
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={S.planTitle}>
      <div className="modal plan-sheet">
        <div className="modal-title plan-title">
          <span>{S.planTitle}</span>
          <button type="button" className="plan-close" onClick={onClose}>닫기</button>
        </div>
        {confirm ? (
          <>
            <div className="modal-body">
              <p>
                {TIER_TOPIC[confirm.tier]} 사진을 {keptFor(plans[confirm.tier]?.retentionDays ?? null)} 동안 보관해요.{' '}
                {confirm.count != null ? `그보다 오래된 사진 ${confirm.count}장은` : '그보다 오래된 사진은'} 일주일 뒤부터 지워져요.
              </p>
              <div className="help">지워진 사진은 되돌릴 수 없어요. 하트와 답장은 그대로 남아요.</div>
            </div>
            <div className="modal-actions">
              <button type="button" className="signin-secondary" disabled={busy != null} onClick={onCancelConfirm}>취소</button>
              <button type="button" className="linkbtn" disabled={busy != null} onClick={onConfirm}>
                <span>{busy ? '바꾸는 중…' : `${TIER_TO[confirm.tier]} 바꾸기`}</span>
              </button>
            </div>
          </>
        ) : (
          <div className="modal-body">
            {why && <div className="plan-reason">{why}</div>}
            {memory && memory.count > 0 && <div className="plan-memory">{S.planMemoryStrip(memory.count, days ?? null)}</div>}
            <PlanCards plans={plans} current={current} patientName={patientName} suggested={suggested} canChange={canChange} busy={busy} onChoose={onChoose} />
            {!canChange && <div className="help">{S.planViewer}</div>}
            {canChange && !PAYMENTS_LIVE && <div className="help">{S.planBeta}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 부모님께 드리는 선물. Opens from exactly four places: 가족초대 at the
 * plan's count, the "사진이 지워져요" notice, the locked voice card, and 설정.
 */
export function PlanSheet({ plans, patientUid, patientName, plan, reason, canChange, onClose }: {
  plans: Plans
  patientUid: string
  patientName: string
  /** users/{patientUid}.plan as loaded; undefined when nobody has set one. */
  plan: { tier: PlanTier; since?: { toMillis: () => number } } | undefined
  reason: PlanReason
  canChange: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const [nowMs] = useState(() => Date.now())
  const [memory, setMemory] = useState<{ uid: string; value: Memory } | null>(null)
  const [busy, setBusy] = useState<PlanTier | null>(null)
  const [confirm, setConfirm] = useState<KeepingConfirm | null>(null)
  const current = plan?.tier ?? 'free'

  useEffect(() => {
    let live = true
    loadMemory(patientUid)
      .then((value) => { if (live) setMemory({ uid: patientUid, value }) })
      .catch((err) => console.warn('[plan] could not count kept photos', err))
    return () => { live = false }
  }, [patientUid])

  const change = async (tier: PlanTier) => {
    setBusy(tier)
    try {
      const res = await changePlan(patientUid, tier, reason.kind)
      toast.show(`${TIER_TO[tier]} 바꿨어요`, res.unlockedVoices > 0 ? `지난 음성 답장 ${res.unlockedVoices}개가 열렸어요` : undefined)
      onClose()
    } catch (err) {
      console.error('[plan] change failed', err)
      toast.show('바꾸지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
      setBusy(null)
    }
  }

  // A plan that keeps photos for a shorter time is asked about first, with
  // how many photos that would let go.
  const choose = async (tier: PlanTier) => {
    if (!shortensKeeping(plans, !!plan, current, tier)) return change(tier)
    setBusy(tier)
    const count = await countPhotosBefore(patientUid, nowMs - plans[tier]!.retentionDays! * DAY_MS).catch(() => null)
    setBusy(null)
    if (count === 0) return change(tier)
    setConfirm({ tier, count })
  }

  return (
    <PlanSheetView
      plans={plans}
      patientName={patientName}
      current={current}
      hasPlanSinceMs={plan ? plan.since?.toMillis() ?? null : undefined}
      reason={reason}
      canChange={canChange}
      memory={memory && memory.uid === patientUid ? memory.value : null}
      nowMs={nowMs}
      busy={busy}
      confirm={confirm}
      onChoose={(tier) => void choose(tier)}
      onConfirm={() => confirm && void change(confirm.tier)}
      onCancelConfirm={() => setConfirm(null)}
      onClose={onClose}
    />
  )
}
