// Plans (admin_config/plans): entitlements per tier and rollout flags.
//
// Read once per app start and kept in memory; a copy in localStorage lets
// the next start render at once while the fresh copy loads. Nothing about a
// tier is hard-coded in the app. Until a copy has ever been loaded, every
// flag reads as off and every gated family feature as not included.

import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { isSimple } from './edition'
import type { PlanEntitlements, Plans, PlanTier } from '../types'

const CACHE_KEY = 'tbp.plans.v1'

let loaded: Promise<Plans | null> | null = null

export function cachedPlans(): Plans | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Plans) : null
  } catch {
    return null
  }
}

/** The plans doc, fetched at most once per app start. Null when it can't be read. */
export function loadPlans(): Promise<Plans | null> {
  loaded ??= getDoc(doc(db, 'admin_config', 'plans'))
    .then((snap) => {
      if (!snap.exists()) return null
      const plans = snap.data() as Plans
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(plans)) } catch { /* private mode */ }
      return plans
    })
    .catch((err) => {
      console.warn('[plans] could not load; using the last copy', err)
      loaded = null // try again on the next call (e.g. after sign-in)
      return cachedPlans()
    })
  return loaded
}

export function entitlements(plans: Plans | null, tier: PlanTier | undefined): PlanEntitlements | null {
  return plans?.[tier ?? 'free'] ?? null
}

type Flag = keyof Plans['flags']

/**
 * Features the simple edition doesn't have, whatever the plans doc says
 * (docs/Daylie-v3-Simple-Core.md §4): 다녀온 곳, plans and prices, voice
 * replies, digests (in-app, e-mail, messenger), and family photos — the
 * parent's camera screen has nowhere to show those.
 */
export const SIMPLE_FLAGS_OFF: ReadonlySet<Flag> = new Set<Flag>([
  'trailMap', 'planSheet', 'voiceReplies', 'digest', 'emailDigest', 'messengerFree', 'familyPhotos',
])

export function flagOn(plans: Plans | null, flag: Flag): boolean {
  if (isSimple() && SIMPLE_FLAGS_OFF.has(flag)) return false
  return plans?.flags?.[flag] === true
}
