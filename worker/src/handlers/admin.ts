/**
 * Super-admin request handlers (formerly admin-only HTTPS callables):
 *   regenerateMemo      — A/B a stored memo against the active local model
 *   backfillMemoSchema  — one-shot schema migration
 *   backfillPatientUid  — one-shot schema migration
 *
 * Admin identity is the email on the request doc, which rules pin to the
 * caller's verified token email.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { logger } from '../log.js'
import { WorkerError as HttpsError, type Caller } from '../context.js'
import { generateMemo } from '../llm/ollama.js'
import { areaOf, readableText } from '../llm/prompt.js'
import { homeHintFor, localTimeHint } from '../travel.js'

export const ADMIN_EMAIL = 'zymer4him@gmail.com'

function requireAdmin(caller: Caller) {
  if (caller.email !== ADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'admin only')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// regenerateMemo
//
// Re-runs a single memo through the currently active model and returns the
// new output WITHOUT persisting. The dashboard uses this for A/B testing:
// shows old (stored) vs new (just generated) side-by-side so you can decide
// whether the new model/prompt is actually an improvement before keeping it.
// ────────────────────────────────────────────────────────────────────────────

export async function regenerateMemo(caller: Caller, data: { memoId?: string }) {
  requireAdmin(caller)
  const memoId = data?.memoId?.trim()
  if (!memoId) {
    throw new HttpsError('invalid-argument', 'memoId required')
  }

  const db = getFirestore()
  const snap = await db.collection('memos').doc(memoId).get()
  if (!snap.exists) {
    throw new HttpsError('not-found', `memo ${memoId} not found`)
  }
  const memo = snap.data()!
  const photoPath = memo.photoPath as string | undefined
  if (!photoPath) {
    throw new HttpsError('failed-precondition', 'memo has no photoPath')
  }

  const [buffer] = await getStorage().bucket().file(photoPath).download()
  const patientUid = (memo.patientUid as string) || ''
  const lat = typeof memo.lat === 'number' ? memo.lat : null
  const lng = typeof memo.lng === 'number' ? memo.lng : null
  let result
  try {
    // Same hints the pipeline gives, so the comparison is like for like.
    result = await generateMemo({
      imageBase64: buffer.toString('base64'),
      timeHint: await localTimeHint(patientUid, memo.takenAt?.toDate?.(), lat, lng),
      placeHint: areaOf((memo.place as string | undefined) || '') || undefined,
      homeHint: await homeHintFor(patientUid, lat, lng),
      textHint: readableText((memo.tags as { text?: string[] } | undefined)?.text),
    })
  } catch (err) {
    throw new HttpsError('internal', `local model failed: ${(err as Error).message}`)
  }

  return {
    memoId,
    old: {
      activity: (memo.activity as string) || '',
      memo: (memo.memo as string) || '',
      scene: (memo.scene as string) || '',
      memoSource: (memo.memoSource as string) || '',
      model: (memo.model as string) || '',
    },
    new: {
      activity: result.activity,
      memo: result.memo,
      scene: result.scene,
      model: result.model,
    },
    cost: result.cost,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// backfillMemoSchema — one-shot admin migration.
//
// The tone refresh switched the memo schema from
//   { activity: "<Korean sentence>", details: "<longer>", category: "<one-word>" }
// to
//   { activity: "<one-word category>", memo: "<warm sentence>" }
//
// This handler walks every memo doc lacking a `memo` field and:
//   1. Moves the old sentence (data.activity) into `memo`.
//   2. Maps old data.category → new activity (one-word). `일상` becomes `기타`
//      since the category is gone in the new schema; the other four
//      (식사/산책/휴식/가족) carry over 1:1.
//   3. Deletes the legacy `details` and old-meaning `category` fields.
//
// Idempotent: docs already carrying a `memo` string are skipped, so re-running
// is a no-op. Run once from /superadmin after deploy.
// ────────────────────────────────────────────────────────────────────────────

const LEGACY_CATEGORY_MAP: Record<string, string> = {
  '식사': '식사',
  '산책': '산책',
  '휴식': '휴식',
  '가족': '가족',
  '꽃':   '꽃',
  '일상': '기타',  // dropped category — map to 기타
  '기타': '기타',
}

interface BackfillMemoStats {
  scanned: number
  migrated: number
  alreadyOk: number
  skippedEmpty: number
}

export async function backfillMemoSchema(caller: Caller): Promise<BackfillMemoStats> {
  requireAdmin(caller)
  const db = getFirestore()
  const snap = await db.collection('memos').get()
  let scanned = 0
  let migrated = 0
  let alreadyOk = 0
  let skippedEmpty = 0

  let batch = db.batch()
  let batchCount = 0
  const flush = async () => {
    if (batchCount === 0) return
    await batch.commit()
    batch = db.batch()
    batchCount = 0
  }

  for (const docSnap of snap.docs) {
    scanned++
    const data = docSnap.data() as {
      activity?: unknown
      memo?: unknown
      details?: unknown
      category?: unknown
    }

    // Already migrated: has a `memo` string and no legacy fields.
    const hasNewMemo = typeof data.memo === 'string'
    const hasLegacyFields = data.details !== undefined || data.category !== undefined
    if (hasNewMemo && !hasLegacyFields) { alreadyOk++; continue }

    // A doc with no activity sentence AND no legacy category is too empty to
    // confidently migrate (probably an aborted pending doc). Mark it 기타/''
    // anyway so it conforms to the new schema and the UI renders sanely.
    const legacyActivity = typeof data.activity === 'string' ? data.activity : ''
    const legacyCategory = typeof data.category === 'string' ? data.category : ''
    if (!legacyActivity && !legacyCategory && !hasNewMemo) {
      skippedEmpty++
      batch.update(docSnap.ref, {
        activity: '기타',
        memo: '',
        details: FieldValue.delete(),
        category: FieldValue.delete(),
      })
      batchCount++
      if (batchCount >= 400) await flush()
      continue
    }

    const newMemo = hasNewMemo ? (data.memo as string) : legacyActivity
    const newActivity = LEGACY_CATEGORY_MAP[legacyCategory] || '기타'

    batch.update(docSnap.ref, {
      activity: newActivity,
      memo: newMemo,
      details: FieldValue.delete(),
      category: FieldValue.delete(),
    })
    batchCount++
    migrated++
    if (batchCount >= 400) await flush()
  }
  await flush()

  logger.info('[backfill] memo schema done', { scanned, migrated, alreadyOk, skippedEmpty })
  return { scanned, migrated, alreadyOk, skippedEmpty }
}

// ────────────────────────────────────────────────────────────────────────────
// backfillPatientUid — one-shot admin migration.
//
// The caregiver-share schema renamed `memos.uid` → `memos.patientUid` so
// the field name matches semantic intent (the patient the memo belongs to,
// not the uploader's auth uid — which for self-managed accounts happen to be
// the same value). This handler walks every memo doc lacking `patientUid`
// and copies `uid` into it.
//
// Idempotent: docs already carrying `patientUid` are skipped, so re-running
// is a no-op. Run once from /superadmin; can be safely deleted
// from the codebase a few weeks later once we're sure no legacy docs remain.
// ────────────────────────────────────────────────────────────────────────────
export async function backfillPatientUid(caller: Caller) {
  requireAdmin(caller)
  const db = getFirestore()
  const snap = await db.collection('memos').get()
  let scanned = 0
  let migrated = 0
  let alreadyOk = 0
  let skippedNoUid = 0

  // Batched writes — Firestore caps a batch at 500 ops; we chunk
  // defensively at 400 to leave headroom.
  let batch = db.batch()
  let batchCount = 0
  const flush = async () => {
    if (batchCount === 0) return
    await batch.commit()
    batch = db.batch()
    batchCount = 0
  }

  for (const docSnap of snap.docs) {
    scanned++
    const data = docSnap.data() as { uid?: string; patientUid?: string }
    if (data.patientUid) { alreadyOk++; continue }
    if (!data.uid) { skippedNoUid++; continue }
    batch.update(docSnap.ref, { patientUid: data.uid })
    batchCount++
    migrated++
    if (batchCount >= 400) await flush()
  }
  await flush()

  logger.info('[backfill] patientUid done', { scanned, migrated, alreadyOk, skippedNoUid })
  return { scanned, migrated, alreadyOk, skippedNoUid }
}
