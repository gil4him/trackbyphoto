// 운영실 비용: reading and saving what lib/adminCosts.ts works with. The
// dashboard doc (admin_config/dashboard) is the admin's to write; AI cost is
// summed from the worker's admin_daily rows.

import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import { monthDays, type FixedCost } from './adminCosts'

export async function loadMonthCosts(month: string): Promise<{ dashboard: Record<string, unknown> | null; aiUSD: number }> {
  const { from, to } = monthDays(month)
  const [dash, daily] = await Promise.all([
    getDoc(doc(db, 'admin_config', 'dashboard')),
    getDocs(query(collection(db, 'admin_daily'), where('date', '>=', from), where('date', '<=', to))),
  ])
  const aiUSD = daily.docs.reduce((s, d) => s + (typeof d.get('geminiUSD') === 'number' ? d.get('geminiUSD') as number : 0), 0)
  return { dashboard: dash.exists() ? dash.data() : null, aiUSD }
}

/** The month's Firebase bill (and optional split), into costs[month]. */
export async function saveFirebaseEntry(month: string, e: { firebaseUSD: number | null; budgetUSD: number; storageUSD: number | null; firestoreUSD: number | null; hostingUSD: number | null; otherUSD: number | null }): Promise<void> {
  await setDoc(doc(db, 'admin_config', 'dashboard'), { costs: { [month]: { ...e, savedAt: serverTimestamp() } } }, { merge: true })
}

export async function saveFixed(fixed: FixedCost[], fx: number): Promise<void> {
  await setDoc(doc(db, 'admin_config', 'dashboard'), { fixed, fx }, { merge: true })
}
