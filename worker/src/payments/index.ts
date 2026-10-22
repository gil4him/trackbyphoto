/**
 * Paying for a plan sits behind this interface.
 *
 * The real provider is RevenueCat (revenuecat.ts): the family buys in the
 * store app and the worker asks RevenueCat what the payer is entitled to.
 * `confirm` is an outbound call either way, so the worker still needs no
 * open port, and it returns the reference changePlan stores on the plan.
 *
 * The stand-in approves every change and charges nothing; it is what runs
 * until PAYMENT_PROVIDER names a real one, and what the `payments` flag
 * falls back to so the plan sheet can be tried with nothing charged.
 */

import type { PlanTier } from '../plans.js'
import { revenueCatPayments } from './revenuecat.js'

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
  /** When the plan runs out unless it renews; null for a payment that never
   *  expires. Only a store subscription has one. */
  expiresAt?: Date | null
  /** The store product that was bought. */
  productId?: string
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
  if (name === 'revenuecat') return revenueCatPayments()
  // toss / stripe: not built. Refuse rather than change plans unpaid.
  return {
    name,
    confirm: async () => ({ ok: false, provider: name, reason: `payment provider "${name}" is not set up` }),
  }
}
