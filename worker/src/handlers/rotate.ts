/**
 * Turn a memo's photo for good (사진 돌리기, owner decision 2026-10-30).
 *
 * The ↻ button on a photo's page (the parent's own phone, the family's
 * admin and guardian; firestore.rules' memo update) adds 90 to
 * `memos.rotation` per tap. That field is a pending request: clockwise
 * degrees not yet baked into the stored photo. Phones show the photo turned
 * by it with a CSS transform for the few seconds until this bakes it.
 *
 * Baking rewrites the stored original (upright, JPEG q90, no orientation
 * tag) and its thumbnail under new download tokens. Both are cached by
 * phones for a year (thumbs.ts PHOTO_CACHE), so only new links show the new
 * pixels; every app version, shared copy and the AI then see the photo the
 * right way up. The field is then lowered by what was baked (a tap made
 * mid-bake stays pending and is baked next) and `rotatedAt` stamped.
 *
 * Invariant at every instant: show = stored pixels turned by rotation % 360.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { logger } from '../log.js'
import { remakeThumb, replacePhoto, rotateJpeg } from '../thumbs.js'

const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000]

export interface RotateDeps {
  /** The stored photo's bytes; null when the file isn't there. */
  load: (photoPath: string) => Promise<Buffer | null>
  /** Overwrite the stored photo; returns its new link (photoUrl). */
  store: (photoPath: string, bytes: Buffer) => Promise<string>
  /** Remake the thumbnail from the new bytes; returns its new link (thumbUrl). */
  thumbOf: (photoPath: string, bytes: Buffer) => Promise<string>
  /** Turn the photo `deg` degrees clockwise. */
  turn: (bytes: Buffer, deg: number) => Promise<Buffer>
}

export const defaultRotateDeps: RotateDeps = {
  load: async (photoPath) => {
    const file = getStorage().bucket().file(photoPath)
    const [exists] = await file.exists()
    if (!exists) return null
    return (await file.download())[0]
  },
  store: replacePhoto,
  thumbOf: remakeThumb,
  turn: rotateJpeg,
}

/** Any number of degrees → 0, 90, 180 or 270 (clockwise). */
export function normalizeRotation(deg: number): number {
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360
}

export type RotateOutcome = 'done' | 'again' | 'retry'

/** Bake a memo's pending rotation. 'again' when more taps came in meanwhile. */
export async function rotateMemo(memoId: string, deps: RotateDeps = defaultRotateDeps): Promise<RotateOutcome> {
  const ref = getFirestore().collection('memos').doc(memoId)
  try {
    const data = (await ref.get()).data()
    if (!data || data.rotation === undefined) return 'done'
    const raw = data.rotation
    const deg = typeof raw === 'number' && Number.isFinite(raw) ? normalizeRotation(raw) : 0
    if (deg === 0) {
      await ref.update({ rotation: FieldValue.delete() })
      return 'done'
    }
    const patientUid = data.patientUid as string
    const photoPath = data.photoPath as string
    if (!patientUid || !photoPath?.startsWith(`photos/${patientUid}/`)) {
      logger.warn('[rotate] photo outside the owner folder', { memoId })
      await ref.update({ rotation: FieldValue.delete() })
      return 'done'
    }
    const original = await deps.load(photoPath)
    if (!original) {
      logger.warn('[rotate] photo missing', { memoId })
      await ref.update({ rotation: FieldValue.delete() })
      return 'done'
    }

    const turned = await deps.turn(original, deg)
    const photoUrl = await deps.store(photoPath, turned)
    // The old thumbnail is wrong now; without a new one the lists show the
    // (right) full photo.
    const thumbUrl = await deps.thumbOf(photoPath, turned).catch((err) => {
      logger.warn('[rotate] thumbnail not made', { memoId, err: String(err) })
      return null
    })

    const remaining = await getFirestore().runTransaction(async (tx) => {
      const now = (await tx.get(ref)).data()
      const current = typeof now?.rotation === 'number' && Number.isFinite(now.rotation) ? now.rotation : 0
      const left = normalizeRotation(current - deg)
      if (!now) return 0
      tx.update(ref, {
        photoUrl,
        thumbUrl: thumbUrl ?? FieldValue.delete(),
        rotation: left || FieldValue.delete(),
        rotatedAt: FieldValue.serverTimestamp(),
      })
      return left
    })
    logger.info('[rotate] baked', { memoId, deg })
    return remaining ? 'again' : 'done'
  } catch (err) {
    logger.warn('[rotate] bake failed', { memoId, err: String(err) })
    return 'retry'
  }
}

/** Subscribe to memos with a pending rotation. One bake per memo at a time;
 *  a tap made mid-bake (a modify) is picked up when the bake ends. */
export function watchRotations(deps: RotateDeps = defaultRotateDeps): () => void {
  const attempts = new Map<string, number>()
  const timers = new Map<string, NodeJS.Timeout>()
  const inFlight = new Set<string>()
  const dirty = new Set<string>()

  const run = async (memoId: string): Promise<void> => {
    if (inFlight.has(memoId)) { dirty.add(memoId); return }
    const t = timers.get(memoId)
    if (t) { clearTimeout(t); timers.delete(memoId) }
    inFlight.add(memoId)
    dirty.delete(memoId)
    const outcome = await rotateMemo(memoId, deps)
    inFlight.delete(memoId)
    if (outcome === 'again' || (outcome === 'done' && dirty.has(memoId))) {
      attempts.delete(memoId)
      dirty.delete(memoId)
      void run(memoId)
      return
    }
    if (outcome === 'done') { attempts.delete(memoId); return }
    const attempt = attempts.get(memoId) ?? 0
    if (attempt >= RETRY_DELAYS_MS.length) {
      // Leave the field set: the next worker start tries again.
      logger.warn('[rotate] giving up for now', { memoId })
      attempts.delete(memoId)
      return
    }
    attempts.set(memoId, attempt + 1)
    timers.set(memoId, setTimeout(() => { timers.delete(memoId); void run(memoId) }, RETRY_DELAYS_MS[attempt]))
  }

  const unsub = getFirestore()
    .collection('memos')
    .where('rotation', '>', 0)
    .onSnapshot(
      (snap) => {
        for (const change of snap.docChanges()) {
          const id = change.doc.id
          if (change.type === 'removed') {
            const t = timers.get(id)
            if (t) clearTimeout(t)
            timers.delete(id)
            attempts.delete(id)
          } else if (!timers.has(id)) {
            // added, or modified (another tap): bake now unless backing off.
            void run(id)
          }
        }
      },
      (err) => {
        logger.error('[rotate] listener died; exiting so launchd restarts us', { err: String(err) })
        process.exit(1)
      },
    )
  return () => {
    unsub()
    for (const t of timers.values()) clearTimeout(t)
  }
}
