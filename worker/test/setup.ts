// Shared emulator wiring for the worker tests. Importing this module
// initializes the default firebase-admin app against the Firestore emulator,
// so every handler's getFirestore() resolves to it.

import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

export const PROJECT = 'demo-trackbyphoto'
process.env.GCLOUD_PROJECT = PROJECT
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'

if (!getApps().length) initializeApp({ projectId: PROJECT })
export const db = getFirestore()

export async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
}

export async function seedMembership(patientUid: string, caregiverUid: string, extra: Record<string, unknown> = {}) {
  await db.doc(`memberships/${patientUid}_${caregiverUid}`).set({
    patientUid, caregiverUid, role: 'admin', status: 'active', consentId: 'c1', ...extra,
  })
}

export const count = async (coll: string, field: string, value: string) =>
  (await db.collection(coll).where(field, '==', value).get()).size
