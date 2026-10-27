import { useEffect, useState } from 'react'
import { useToast } from './Toast'
import { managementUrl, paymentsElsewhere, paymentsLive, PurchaseCancelled, storePrices } from '../lib/payments'
import { LegalLinks } from './LegalLinks'
import {
  TIERS, TIER_NAME, daysUntilOldestGoes, keptFor, offered, planLines, reasonLine, shortensKeeping, suggestedTier,
  type Memory, type PlanReason,
} from '../lib/plan'
import { changePlan, countPhotosBefore, loadMemory, restorePlan } from '../lib/planApi'
import { S } from '../lib/strings'
import { planFailureLine } from '../lib/planErrors'
import { lang, tr } from '../lib/lang'
import type { Plans, PlanTier } from '../types'

const TIER_TO: Record<PlanTier, string> = { free: 'Free로', basic: 'Basic으로', plus: 'Plus로', family: 'Family로' }
const TIER_TOPIC: Record<PlanTier, string> = { free: 'Free는', basic: 'Basic은', plus: 'Plus는', family: 'Family는' }
const DAY_MS = 24 * 3600 * 1000

/**
 * One card for each plan in admin_config/plans. They say what a plan gives
 * the family; nothing here counts photos.
 */
export function PlanCards({ plans, current, patientName, suggested, canChange, busy, prices = {}, onChoose }: {
  plans: Plans
  current: PlanTier
  patientName: string
  /** The store's own price per tier when payments are live; the table's label otherwise. */
  prices?: Partial<Record<PlanTier, string>>
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
        const price = prices[t] ?? ent.priceLabel
        return (
          <div key={t} className={`plan-card${isCurrent ? ' current' : ''}${t === suggested ? ' suggested' : ''}`}>
            <div className="plan-head">
              <b className="plan-name">{TIER_NAME[t]}</b>
              {price && <span className="plan-price">{price}</span>}
              {isCurrent ? <span className="plan-chip">{S.planCurrent}</span> : t === suggested ? <span className="plan-chip rec">{tr('추천', 'Suggested')}</span> : null}
            </div>
            <div className="plan-lines">{planLines(ent, patientName, plans.flags).join(' · ')}</div>
            {canChange && !isCurrent && (
              <button type="button" className="plan-go" disabled={busy != null} onClick={() => onChoose(t)}>
                {busy === t
                  ? tr('바꾸는 중…', 'Switching…')
                  : up
                    ? tr(`${TIER_NAME[t]} 시작하기${price ? ` ${price}` : ''}`, `Start ${TIER_NAME[t]}${price ? ` ${price}` : ''}`)
                    : tr(`${TIER_TO[t]} 바꾸기`, `Switch to ${TIER_NAME[t]}`)}
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
export function PlanSheetView({ plans, patientName, current, hasPlanSinceMs, reason, canChange, memory, nowMs, busy, confirm, live = false, prices = {}, manageUrl = null, until = null, restoring = false, onRestore, onChoose, onConfirm, onCancelConfirm, onClose }: {
  plans: Plans
  patientName: string
  current: PlanTier
  /** The store takes the money on this device (lib/payments paymentsLive). */
  live?: boolean
  prices?: Partial<Record<PlanTier, string>>
  /** The store's subscription page for 구독 관리, once known. */
  manageUrl?: string | null
  /** "10월 30일까지 이용" for a paid plan, from plan.payment.expiresAt. */
  until?: string | null
  restoring?: boolean
  onRestore?: () => void
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
  // The website while payments are on: look, but buy in the app.
  const appOnly = paymentsElsewhere(plans)
  const mayBuy = canChange && !appOnly
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
          <button type="button" className="plan-close" onClick={onClose}>{tr('닫기', 'Close')}</button>
        </div>
        {confirm ? (
          <>
            <div className="modal-body">
              <p>
                {tr(
                  `${TIER_TOPIC[confirm.tier]} 사진을 ${keptFor(plans[confirm.tier]?.retentionDays ?? null)} 동안 보관해요. ${confirm.count != null ? `그보다 오래된 사진 ${confirm.count}장은` : '그보다 오래된 사진은'} 일주일 뒤부터 지워져요.`,
                  `${TIER_NAME[confirm.tier]} keeps photos for ${keptFor(plans[confirm.tier]?.retentionDays ?? null)}. ${confirm.count != null ? `${confirm.count} photo${confirm.count === 1 ? '' : 's'}` : 'Photos'} older than that will be deleted a week from now.`,
                )}
              </p>
              <div className="help">{tr('지워진 사진은 되돌릴 수 없어요. 하트와 답장은 그대로 남아요.', "A deleted photo can't be brought back. Hearts and replies stay.")}</div>
            </div>
            <div className="modal-actions">
              <button type="button" className="signin-secondary" disabled={busy != null} onClick={onCancelConfirm}>{tr('취소', 'Cancel')}</button>
              <button type="button" className="linkbtn" disabled={busy != null} onClick={onConfirm}>
                <span>{busy ? tr('바꾸는 중…', 'Switching…') : tr(`${TIER_TO[confirm.tier]} 바꾸기`, `Switch to ${TIER_NAME[confirm.tier]}`)}</span>
              </button>
            </div>
          </>
        ) : (
          <div className="modal-body">
            {why && <div className="plan-reason">{why}</div>}
            {memory && memory.count > 0 && <div className="plan-memory">{S.planMemoryStrip(memory.count, days ?? null)}</div>}
            {until && current !== 'free' && <div className="plan-until">{S.planUntil(until)}</div>}
            <PlanCards plans={plans} current={current} patientName={patientName} suggested={suggested} canChange={mayBuy} busy={busy} prices={prices} onChoose={onChoose} />
            {!canChange && <div className="help">{S.planViewer}</div>}
            {canChange && appOnly && <div className="help">{S.planAppOnly}</div>}
            {canChange && !appOnly && !live && <div className="help">{S.planBeta}</div>}
            {live && canChange && (
              <div className="plan-store">
                <div className="help">{S.planAutoRenew}</div>
                <div className="plan-store-row">
                  {manageUrl && current !== 'free' && <a className="plan-store-link" href={manageUrl} target="_blank" rel="noopener noreferrer">{S.planManage} ›</a>}
                  {onRestore && <button type="button" className="plan-store-link" disabled={busy != null || restoring} onClick={onRestore}>{restoring ? S.planRestoring : S.planRestore}</button>}
                </div>
                <LegalLinks />
              </div>
            )}
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
  plan: { tier: PlanTier; since?: { toMillis: () => number }; payment?: { expiresAt?: { toMillis: () => number } | null } } | undefined
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
  const live = paymentsLive(plans)
  const [prices, setPrices] = useState<Partial<Record<PlanTier, string>>>({})
  const [manageUrl, setManageUrl] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const expiresMs = plan?.payment?.expiresAt?.toMillis?.()
  const until = expiresMs ? new Date(expiresMs).toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { month: 'long', day: 'numeric' }) : null

  // Live: the store's prices and its subscription page, when they come.
  useEffect(() => {
    if (!live) return
    let on = true
    void storePrices().then((p) => { if (on) setPrices(p) })
    void managementUrl().then((u) => { if (on) setManageUrl(u) })
    return () => { on = false }
  }, [live])

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
      const res = await changePlan(patientUid, tier, reason.kind, live)
      toast.show(
        tr(`${TIER_TO[tier]} 바꿨어요`, `Switched to ${TIER_NAME[tier]}`),
        res.unlockedVoices > 0
          ? tr(`지난 음성 답장 ${res.unlockedVoices}개가 열렸어요`, `${res.unlockedVoices} past voice ${res.unlockedVoices === 1 ? 'reply is' : 'replies are'} now open`)
          : undefined,
      )
      onClose()
    } catch (err) {
      if (err instanceof PurchaseCancelled) { toast.show(S.planCancelled); setBusy(null); return }
      console.error('[plan] change failed', err)
      toast.show(tr('바꾸지 못했어요', "Couldn't change it"), planFailureLine(err))
      setBusy(null)
    }
  }

  // 구매 복원: what the store says this person pays for, put back on the parent.
  const restore = async () => {
    setRestoring(true)
    try {
      const got = await restorePlan(patientUid)
      if (!got) toast.show(S.planNothingToRestore)
      else { toast.show(S.planRestored(TIER_NAME[got.tier])); onClose() }
    } catch (err) {
      console.error('[plan] restore failed', err)
      toast.show(tr('되찾지 못했어요', "Couldn't restore it"), planFailureLine(err))
    } finally {
      setRestoring(false)
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
      live={live}
      prices={prices}
      manageUrl={manageUrl}
      until={until}
      restoring={restoring}
      onRestore={live ? () => void restore() : undefined}
      onChoose={(tier) => void choose(tier)}
      onConfirm={() => confirm && void change(confirm.tier)}
      onCancelConfirm={() => setConfirm(null)}
      onClose={onClose}
    />
  )
}
