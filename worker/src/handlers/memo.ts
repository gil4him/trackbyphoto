/**
 * Photo memo pipeline (formerly the onPhotoUploaded Storage trigger).
 *
 * The client uploads photos/{uid}/{photoId}.{ext}, then creates memos/{photoId}
 * with status 'pending' (rules only let the owner create it, pending, pointing
 * at their own photo folder). The worker watches pending memos and for each:
 *   1. resolves a tokenized download URL for the photo,
 *   2. reverse-geocodes lat/lng (a failed or late lookup is finished by
 *      handlers/place.ts),
 *   3. writes the memo from the photo itself:
 *        a. local vision model on Ollama (memoSource 'local-llm'), told the
 *           time, the place and how far from home the photo was taken,
 *        b. neutral stub after MAX_ATTEMPTS failed generations
 *           (memoSource 'local-stub') so a bad photo can't stay pending forever,
 *      Older app builds also send a memo written on the phone. It is ignored:
 *      the phone's language model only sees a few image labels, never the
 *      photo, and invented things.
 *   4. marks the memo ready, notifies caregivers once, bumps dashboard counters.
 *
 * There is deliberately no paid cloud fallback. If the Mac mini or Ollama is
 * down the memo simply stays pending ("메모 작성 중…") until it's back; the
 * listener's initial snapshot picks up everything that queued meanwhile.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { logger } from '../log.js'
import { bumpAdminCounters } from '../counters.js'
import { reverseGeocode, type GeoResult } from '../geocode.js'
import {
  generateMemo,
  LlmGenerationError,
  LlmUnavailableError,
  REWRITE_TEMPERATURE,
  type LlmResult,
} from '../llm/ollama.js'
import { areaOf, readableText, stubActivity, type PromptHints, type VisionTags } from '../llm/prompt.js'
import { homeHintFor, localTimeHint } from '../travel.js'

/** Failed generations on one photo before falling back to the stub. */
export const MAX_ATTEMPTS = 5
/** How long to wait before retrying a memo whose generation failed. */
const RETRY_DELAYS_MS = [15_000, 60_000, 2 * 60_000, 5 * 60_000]
/** How often to re-check a memo while Ollama is unreachable. */
const UNAVAILABLE_RETRY_MS = 60_000

export interface PhotoInfo {
  base64: () => Promise<string>
  photoUrl: string
}

/** Injected I/O so tests can run without Storage, Ollama, or the network. */
export interface MemoDeps {
  /** Resolve the photo; null when the object doesn't exist. */
  loadPhoto: (photoPath: string) => Promise<PhotoInfo | null>
  geocode: (lat: number | null, lng: number | null) => Promise<GeoResult>
  generate: (args: PromptHints & { imageBase64: string; temperature?: number }) => Promise<LlmResult>
}

export const defaultMemoDeps: MemoDeps = {
  loadPhoto: async (photoPath) => {
    const bucket = getStorage().bucket()
    const file = bucket.file(photoPath)
    const [exists] = await file.exists()
    if (!exists) return null
    // The browser fetches the photo via a plain <img src> with no auth header,
    // so Storage rules would 403 it. The Firebase-style download URL bypasses
    // rules when a `token` query param matches a token in the object's
    // metadata. The Web SDK's uploadBytes auto-generates one; reuse it (or
    // mint a new one if missing).
    const [storageMeta] = await file.getMetadata()
    const existingTokens = (storageMeta.metadata as Record<string, string> | undefined)?.firebaseStorageDownloadTokens
    let token = existingTokens?.split(',')[0]
    if (!token) {
      token = crypto.randomUUID()
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
    }
    return {
      photoUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(photoPath)}?alt=media&token=${token}`,
      base64: async () => (await file.download())[0].toString('base64'),
    }
  },
  geocode: reverseGeocode,
  generate: generateMemo,
}

export type MemoOutcome =
  | 'done'          // memo is ready (or was already handled)
  | 'unavailable'   // Ollama unreachable — retry later, doesn't count
  | 'failed'        // generation failed — counts toward MAX_ATTEMPTS

/**
 * Process one pending memo. `attempt` is 1-based; on the final attempt a
 * generation failure writes the stub instead of returning 'failed'.
 */
export async function processMemo(memoId: string, attempt: number, deps: MemoDeps = defaultMemoDeps): Promise<MemoOutcome> {
  const db = getFirestore()
  const memoRef = db.collection('memos').doc(memoId)
  const snap = await memoRef.get()
  const data = snap.data()
  if (!snap.exists || !data || data.status !== 'pending') return 'done'

  const patientUid = data.patientUid as string
  const photoPath = data.photoPath as string
  const lat = typeof data.lat === 'number' ? data.lat : null
  const lng = typeof data.lng === 'number' ? data.lng : null
  const tags = (data.tags as VisionTags | undefined) ?? null
  const humanEdited = data.humanEdited === true

  // Rules already pin photoPath to the creator's folder; re-check so a
  // malformed doc can't point the worker at someone else's photo.
  if (!patientUid || !photoPath?.startsWith(`photos/${patientUid}/`)) {
    logger.error('[memo] bad photoPath; marking error', { memoId, patientUid, photoPath })
    await memoRef.update({ status: 'error' })
    return 'done'
  }

  const photo = await deps.loadPhoto(photoPath)
  if (!photo) {
    logger.error('[memo] photo missing from Storage; marking error', { memoId, photoPath })
    await memoRef.update({ status: 'error' })
    return 'done'
  }

  // No coordinates yet: the phone may still attach them (it keeps trying for
  // a fix after the upload), so leave place alone rather than writing ''.
  // Coordinates but no answer from the geocoder: flag it for a retry.
  const hasCoords = lat != null && lng != null
  const { place, address } = hasCoords ? await deps.geocode(lat, lng) : { place: '', address: '' }
  const located = !!(place || address)

  let activity: string
  let memo: string
  let scene: string
  let memoSource: string
  let llmCost: LlmResult['cost'] | null = null
  let llmModel: string | null = null

  try {
    const result = await deps.generate({
      imageBase64: await photo.base64(),
      timeHint: await localTimeHint(patientUid, data.takenAt?.toDate?.(), lat, lng, data.tzOffsetMin as number | undefined),
      placeHint: areaOf(place) || undefined,
      homeHint: await homeHintFor(patientUid, lat, lng),
      textHint: readableText(tags?.text),
      // Text already there means someone asked for another take.
      temperature: data.memo ? REWRITE_TEMPERATURE : undefined,
    })
    activity = result.activity
    memo = result.memo
    scene = result.scene
    memoSource = 'local-llm'
    llmCost = result.cost
    llmModel = result.model
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      logger.warn('[memo] ollama unavailable; will retry', { memoId })
      return 'unavailable'
    }
    if (!(err instanceof LlmGenerationError)) throw err
    if (attempt < MAX_ATTEMPTS) {
      logger.warn('[memo] generation failed; will retry', { memoId, attempt, err: err.message })
      return 'failed'
    }
    logger.warn('[memo] generation failed on final attempt; writing stub', { memoId, attempt, err: err.message })
    const stub = stubActivity(tags)
    activity = stub.activity
    memo = stub.memo
    scene = stub.scene
    memoSource = 'local-stub'
  }

  // Skip the interpretive fields when a guardian has already corrected the
  // memo. photoUrl + place/address are still safe to refresh (they're factual).
  const firstCompletion = !data.notifiedAt
  const update: Record<string, unknown> = {
    photoUrl: photo.photoUrl,
    status: 'ready',
    // Sent by older app builds; never used (see header).
    deviceMemo: FieldValue.delete(),
    deviceMemoSource: FieldValue.delete(),
  }
  if (firstCompletion) update.notifiedAt = FieldValue.serverTimestamp()
  if (located) {
    update.place = place
    update.address = address
    update.needsGeocode = FieldValue.delete()
  } else if (hasCoords) {
    update.needsGeocode = true // picked up by handlers/place.ts
  }
  if (!humanEdited) {
    update.activity = activity
    update.memo = memo
    update.scene = scene
    update.memoSource = memoSource
    if (llmModel) update.model = llmModel
  }
  await memoRef.update(update)

  // Notify each active caregiver that a new photo is in — once per memo,
  // gated on notifiedAt so a worker restart mid-flight can't double-notify.
  // Best-effort: never fail the memo over a notice.
  if (firstCompletion) {
    try {
      const cgs = await db.collection('memberships')
        .where('patientUid', '==', patientUid)
        .where('status', '==', 'active')
        .get()
      if (!cgs.empty) {
        const patientName = (await db.collection('users').doc(patientUid).get()).data()?.patientName as string || '사용자'
        const notifyBatch = db.batch()
        cgs.forEach((d) => {
          notifyBatch.set(db.collection('notifications').doc(), {
            recipientUid: d.data().caregiverUid,
            patientUid,
            actorUid: patientUid,
            type: 'photo.new',
            message: `${patientName}님이 새 사진을 올렸어요`,
            memoId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          })
        })
        await notifyBatch.commit()
      }
    } catch (err) {
      logger.warn('[notify] caregiver photo notice failed', { err: String(err) })
    }

    // Roll up dashboard counters. A counter failure must not mark the memo
    // as 'error' — the user-visible result is fine.
    try {
      await bumpAdminCounters({ category: activity, memoSource, model: llmModel, geminiCost: llmCost })
    } catch (err) {
      logger.warn('[admin-counters] failed to bump', { err: String(err) })
    }
  }

  logger.info('[memo] ready', { patientUid, memoId, activity, memoSource, preservedHumanEdit: humanEdited })
  return 'done'
}

/**
 * Serial queue over pending memos. Concurrency 1: the Mac mini runs one
 * generation at a time (Ollama would serialize anyway, and Teleios shares the
 * model RAM). Failed memos are re-queued with backoff instead of blocking the
 * line, so one bad photo never holds up the others.
 */
export class MemoScheduler {
  private queue: string[] = []
  private queued = new Set<string>()
  private running: string | null = null
  private attempts = new Map<string, number>()
  private timers = new Map<string, NodeJS.Timeout>()
  private stopped = false

  constructor(private deps: MemoDeps = defaultMemoDeps) {}

  enqueue(memoId: string) {
    if (this.stopped || this.queued.has(memoId) || this.running === memoId || this.timers.has(memoId)) return
    this.queued.add(memoId)
    this.queue.push(memoId)
    void this.pump()
  }

  /** The memo left the pending set (ready, deleted) — drop any retry state. */
  forget(memoId: string) {
    const t = this.timers.get(memoId)
    if (t) clearTimeout(t)
    this.timers.delete(memoId)
    this.attempts.delete(memoId)
    if (this.queued.delete(memoId)) this.queue = this.queue.filter((id) => id !== memoId)
  }

  stop() {
    this.stopped = true
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  /** Resolves once nothing is queued or running (timers excluded). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 50))
  }

  private retryLater(memoId: string, delayMs: number) {
    if (this.stopped) return
    this.timers.set(memoId, setTimeout(() => {
      this.timers.delete(memoId)
      this.enqueue(memoId)
    }, delayMs))
  }

  private async pump() {
    if (this.running || this.stopped) return
    const memoId = this.queue.shift()
    if (!memoId) return
    this.queued.delete(memoId)
    this.running = memoId
    const attempt = (this.attempts.get(memoId) ?? 0) + 1
    try {
      const outcome = await processMemo(memoId, attempt, this.deps)
      if (outcome === 'done') {
        this.attempts.delete(memoId)
      } else if (outcome === 'unavailable') {
        this.retryLater(memoId, UNAVAILABLE_RETRY_MS)
      } else {
        this.attempts.set(memoId, attempt)
        this.retryLater(memoId, RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)])
      }
    } catch (err) {
      // Unexpected (Firestore/Storage hiccup). Count it like a failed
      // generation so a persistent fault ends in status 'error', not a loop.
      logger.error('[memo] processing threw', { memoId, attempt, err: String(err) })
      if (attempt >= MAX_ATTEMPTS) {
        await getFirestore().collection('memos').doc(memoId).update({ status: 'error' }).catch(() => {})
        this.attempts.delete(memoId)
      } else {
        this.attempts.set(memoId, attempt)
        this.retryLater(memoId, RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)])
      }
    } finally {
      this.running = null
      void this.pump()
    }
  }
}

/** Subscribe to pending memos and feed them to the scheduler. The initial
 *  snapshot includes everything that queued while the worker was down. */
export function watchPendingMemos(scheduler: MemoScheduler): () => void {
  return getFirestore()
    .collection('memos')
    .where('status', '==', 'pending')
    .onSnapshot(
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type === 'removed') scheduler.forget(change.doc.id)
          else scheduler.enqueue(change.doc.id)
        }
      },
      (err) => {
        logger.error('[memo] listener died; exiting so launchd restarts us', { err: String(err) })
        process.exit(1)
      },
    )
}
