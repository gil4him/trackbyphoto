/**
 * Paying for a plan sits behind this interface.
 *
 * Nothing is charged today: the only provider is a stand-in that approves
 * every change. A real provider (Toss Payments in Korea, Stripe elsewhere)
 * would have the app start a checkout and hand its token to changePlan; the
 * provider's `confirm` then verifies it with the payment company (an outbound
 * call, so the worker still needs no open port) and returns the reference
 * that changePlan stores on the plan.
 */

import type { PlanTier } from '../plans.js'

export interface PaymentRequest {
  /** The family member making the change. */
  payerUid: string
  patientUid: string
  from: PlanTier
  to: PlanTier
  /** What the app's checkout handed back; null with the stand-in. */
  token: string | null
}

export interface PaymentResult {
  ok: boolean
  provider: string
  /** The payment company's id for this payment. */
  reference?: string
  reason?: string
}

export interface PaymentProvider {
  name: string
  confirm: (req: PaymentRequest) => Promise<PaymentResult>
}

/** Approves every change and charges nothing. */
export const stubPayments: PaymentProvider = {
  name: 'stub',
  confirm: async () => ({ ok: true, provider: 'stub' }),
}

/** The provider named by PAYMENT_PROVIDER; the stand-in when unset. */
export function paymentProvider(): PaymentProvider {
  const name = process.env.PAYMENT_PROVIDER || 'stub'
  if (name === 'stub') return stubPayments
  // toss / stripe: not built. Refuse rather than change plans unpaid.
  return {
    name,
    confirm: async () => ({ ok: false, provider: name, reason: `payment provider "${name}" is not set up` }),
  }
}
