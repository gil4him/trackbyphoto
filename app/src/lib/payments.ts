// Starting a payment sits behind this interface; the worker's payments/
// confirms what it returns before a plan changes.
//
// Nothing is charged today: the stand-in hands back no token and the
// worker's stand-in approves the change. A real provider (Toss Payments in
// Korea, Stripe elsewhere) would open its checkout here and return the token
// the worker verifies.

import type { PlanTier } from '../types'

export interface Checkout {
  provider: string
  /** What the worker verifies with the payment company; null with the stand-in. */
  token: string | null
}

/** False while the stand-in is in use: the plan sheet then says nothing is charged. */
export const PAYMENTS_LIVE = false

export async function startCheckout(order: { patientUid: string; tier: PlanTier }): Promise<Checkout> {
  void order // a real provider opens its checkout for this order
  return { provider: 'stub', token: null }
}
