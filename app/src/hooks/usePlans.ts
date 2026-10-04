import { useEffect, useState } from 'react'
import { cachedPlans, loadPlans } from '../lib/plans'
import type { Plans } from '../types'

/** Plans for a signed-in session: the cached copy at once, then the fresh one. */
export function usePlans(signedIn: boolean): Plans | null {
  const [plans, setPlans] = useState<Plans | null>(cachedPlans)
  useEffect(() => {
    if (!signedIn) return
    let live = true
    loadPlans().then((p) => { if (live && p) setPlans(p) })
    return () => { live = false }
  }, [signedIn])
  return plans
}
