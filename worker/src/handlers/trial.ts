/**
 * The free trial on Plus and Family (owner decision, 2026-10-28): the stores
 * run a 2-week introductory offer, and the payer — never the parent — is told
 * three things about it:
 *
 *   plan.trialStarted  when changePlan records a purchase in its trial (알림 only)
 *   plan.trialEnding   from the poll, once, in the last 3 days (알림 and push)
 *   plan.trialEnded    from the poll, when the trial ran out unpaid (알림 only)
 *
 * The wording is owner-approved; changing it needs the owner's approval. Each
 * notice has a fixed id and is written with create(), so it goes out once
 * however often the poll runs. All three sit behind the `planNudges` flag;
 * recording the trial on the plan does not.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { resolveGeoLang } from '../travel.js'
import type { PlanTier, PlansDoc } from '../plans.js'
import { addressed } from './adminCheckIn.js'
import { elderName } from './pairing.js'
import type { PushMessage } from './push.js'

export type TrialNotice = 'plan.trialStarted' | 'plan.trialEnding' | 'plan.trialEnded'

/** The last stretch of a trial in which the payer is reminded. */
export const TRIAL_ENDING_MS = 3 * 24 * 3600_000

const TZ = 'Asia/Seoul'

interface Words { name: string; tier: string; date: string; price: string }

/** The owner-approved wording (2026-10-28). */
export const TRIAL_TEXT: Record<'ko' | 'en', Record<TrialNotice, (w: Words) => string>> = {
  ko: {
    'plan.trialStarted': (w) => `${w.name} ${w.tier} 무료 체험을 시작했어요. ${w.date}부터 매월 ${w.price}이 결제돼요. 체험 중 그만두시려면 스토어에서 해지해 주세요.`,
    'plan.trialEnding': (w) => `${w.name} ${w.tier} 무료 체험이 ${w.date}에 끝나요. 그대로 두시면 그날부터 매월 ${w.price}이 결제돼요. 계속하지 않으시려면 스토어에서 해지해 주세요.`,
    'plan.trialEnded': (w) => `${w.name} ${w.tier} 체험이 끝나 Free로 돌아왔어요. 다시 시작하시려면 설정 › 부모님께 드리는 선물에서 고르실 수 있어요.`,
  },
  en: {
    'plan.trialStarted': (w) => `Your ${w.tier} free trial for ${w.name} has started. From ${w.date} you'll be billed ${w.price} a month. To stop during the trial, cancel in the store.`,
    'plan.trialEnding': (w) => `The ${w.tier} free trial for ${w.name} ends on ${w.date}. If you keep it, ${w.price} is billed monthly from then on. To stop, cancel in the store.`,
    'plan.trialEnded': (w) => `The ${w.tier} trial for ${w.name} has ended and the plan is back on Free. You can start again from Settings › A gift for your parent.`,
  },
}

/** "Plus", "Family": the plan's name as the sheet shows it. */
export const tierName = (tier: PlanTier) => tier.charAt(0).toUpperCase() + tier.slice(1)

/** The plans table's price without its "/월" ("₩4,400/월" → "₩4,400"); null when the table has none. */
export function trialPrice(plans: PlansDoc | null, tier: PlanTier): string | null {
  const label = plans?.[tier]?.priceLabel
  if (typeof label !== 'string' || !label.trim()) return null
  return label.replace(/\s*\/\s*월\s*$/, '').trim() || null
}

/** The day in Seoul: "11월 11일" / "November 11". */
export function trialDate(ms: number, lang: 'ko' | 'en'): string {
  if (lang === 'en') return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long', day: 'numeric' }).format(ms)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'numeric', day: 'numeric' }).formatToParts(ms)
  const n = (type: string) => parts.find((p) => p.type === type)?.value
  return `${n('month')}월 ${n('day')}일`
}

/** The day in Seoul as YYYYMMDD, for the notice ids. */
export function seoulDayKey(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms).replace(/-/g, '')
}

/** The fixed id that makes each notice once-only. */
export function trialNoticeId(kind: TrialNotice, payerUid: string, patientUid: string, dayMs: number): string {
  if (kind === 'plan.trialStarted') return `plan_trial_start_${payerUid}_${patientUid}`
  if (kind === 'plan.trialEnding') return `plan_trial_ending_${payerUid}_${patientUid}_${seoulDayKey(dayMs)}`
  return `plan_trial_ended_${payerUid}_${patientUid}_${seoulDayKey(dayMs)}`
}

export interface TrialNoticeRequest {
  kind: TrialNotice
  payerUid: string
  patientUid: string
  tier: PlanTier
  /** When the trial ends (or ended); the date in the words and the id. */
  trialEndsAtMs: number
  plans: PlansDoc | null
  /** Only plan.trialEnding is pushed; the others stay in 알림. */
  push?: (uids: string[], message: PushMessage) => Promise<unknown>
}

/**
 * Tell the payer, once. Returns true when the notice was written now, false
 * when it already was, the flag is off, or the price is unknown. Never sent
 * to the parent.
 */
export async function sendTrialNotice(req: TrialNoticeRequest): Promise<boolean> {
  const { kind, payerUid, patientUid, tier, trialEndsAtMs, plans } = req
  if (plans?.flags?.planNudges !== true) return false
  if (!payerUid || payerUid === patientUid) return false
  const price = trialPrice(plans, tier)
  // N2 and N3 quote the price; without one there is no honest line to send.
  if (!price && kind !== 'plan.trialEnded') {
    logger.warn('[trial] no price in the plans table; notice skipped', { kind, tier, payerUid, patientUid })
    return false
  }

  const lang = (await resolveGeoLang(payerUid)) === 'en' ? 'en' : 'ko'
  const raw = await elderName(patientUid)
  // English drops 님 (CLAUDE.md, English); Korean says it as the app does (엄마, 영희님).
  // No name on file reads as 부모님, which in English is "your parent".
  const name = lang === 'en' ? (raw === '부모님' ? 'your parent' : raw.replace(/\s*님$/, '') || 'your parent') : addressed(raw)
  const message = TRIAL_TEXT[lang][kind]({ name, tier: tierName(tier), date: trialDate(trialEndsAtMs, lang), price: price ?? '' })

  const db = getFirestore()
  try {
    await db.doc(`notifications/${trialNoticeId(kind, payerUid, patientUid, trialEndsAtMs)}`).create({
      recipientUid: payerUid,
      patientUid,
      actorUid: 'worker',
      type: kind,
      message,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false // 6 = already exists
    throw err
  }
  if (kind === 'plan.trialEnding' && req.push) {
    // Best effort, like every family push: the 알림 list already has it.
    await req.push([payerUid], { title: 'Daylie', body: message, data: { type: kind, patientUid } }).catch(() => 0)
  }
  logger.info('[trial] notice', { kind, payerUid, patientUid, tier })
  return true
}
