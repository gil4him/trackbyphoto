/**
 * Reactions: hearts and comments from family; hearts, written replies and
 * voice replies from the parent.
 *
 * Clients write reactions/{id} directly (rules decide who may write what) and
 * always with `notified: false`. The worker watches for those and, once per
 * reaction:
 *   - family heart / comment → one notice for the parent (never a push),
 *   - parent heart          → a notice for every active family member,
 *   - parent written reply  → the same notice, and a push,
 *   - parent voice          → transcribe the clip locally, add a playable
 *                             link, mark it ready, then notify the family.
 *
 * A voice reply is always stored and transcribed, on every plan. Whether the
 * family can hear it is decided on the family side (plans[tier].voiceReplies);
 * the parent never learns that anything was locked.
 *
 * Finishing a reaction (ready + notices + notified: true) is one transaction
 * that re-checks `notified`, so two runs of the same reaction can never send
 * the notices twice. If speech-to-text is down the reply stays pending, like
 * a memo while Ollama is down; after MAX_ATTEMPTS failed runs it is marked
 * ready without a transcript, so the family can still play it.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { logger } from '../log.js'
import { withModelLock } from '../llm/lock.js'
import { SttError, SttUnavailableError, transcribe } from '../llm/stt.js'
import { pushToUsers, type PushMessage } from './push.js'

export const MAX_ATTEMPTS = 5
const RETRY_DELAYS_MS = [15_000, 60_000, 2 * 60_000, 5 * 60_000]
const UNAVAILABLE_RETRY_MS = 60_000
const CLIP_MAX_BYTES = 2 * 1024 * 1024

export interface ClipInfo {
  audioUrl: string
  bytes: () => Promise<Buffer>
}

/** Injected I/O so tests run without Storage or whisper. */
export interface ReactionDeps {
  /** Resolve the clip; null when it is missing or too large. */
  loadClip: (audioPath: string) => Promise<ClipInfo | null>
  transcribe: (audio: Buffer) => Promise<string>
  /** Push a voice reply to family devices (default: handlers/push). */
  push?: (uids: string[], message: PushMessage) => Promise<unknown>
}

export const defaultReactionDeps: ReactionDeps = {
  loadClip: async (audioPath) => {
    const bucket = getStorage().bucket()
    const file = bucket.file(audioPath)
    const [exists] = await file.exists()
    if (!exists) return null
    const [meta] = await file.getMetadata()
    if (Number(meta.size) > CLIP_MAX_BYTES) return null
    // Family can't read voice/ through Storage rules; like photos, they get a
    // tokenized link.
    let token = (meta.metadata as Record<string, string> | undefined)?.firebaseStorageDownloadTokens?.split(',')[0]
    if (!token) {
      token = crypto.randomUUID()
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
    }
    return {
      audioUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(audioPath)}?alt=media&token=${token}`,
      bytes: async () => (await file.download())[0],
    }
  },
  transcribe: (audio) => withModelLock(() => transcribe(audio)),
}

export type ReactionOutcome =
  | 'done'          // handled (or nothing to do)
  | 'unavailable'   // speech-to-text can't run — retry later, doesn't count
  | 'failed'        // transcription failed — counts toward MAX_ATTEMPTS

const FAMILY_KINDS = ['heart', 'comment']
const ELDER_KINDS = ['heart', 'comment', 'voice']

/** Process one reaction that hasn't been announced yet. `attempt` is 1-based. */
export async function processReaction(reactionId: string, attempt: number, deps: ReactionDeps = defaultReactionDeps): Promise<ReactionOutcome> {
  const db = getFirestore()
  const ref = db.collection('reactions').doc(reactionId)
  const data = (await ref.get()).data()
  if (!data || data.notified !== false) return 'done'

  const patientUid = data.patientUid as string
  const actorUid = data.actorUid as string
  const kind = data.kind as string
  const fromElder = actorUid === patientUid
  if (!patientUid || !actorUid || !(fromElder ? ELDER_KINDS : FAMILY_KINDS).includes(kind)) {
    logger.error('[reaction] malformed; marking error', { reactionId, kind })
    await ref.update({ status: 'error', notified: true })
    return 'done'
  }

  const update: Record<string, unknown> = { notified: true }
  if (kind === 'voice' && data.status === 'pending') {
    const audioPath = data.audioPath as string
    // Rules already pin the clip to the parent's own folder; re-check so a
    // malformed doc can't point the worker at someone else's file.
    const clip = audioPath?.startsWith(`voice/${patientUid}/`) ? await deps.loadClip(audioPath) : null
    if (!clip) {
      // The phone uploads the clip before it writes the reaction, so a
      // missing clip is not a race.
      logger.error('[reaction] voice clip missing or invalid; marking error', { reactionId, audioPath })
      await ref.update({ status: 'error', notified: true })
      return 'done'
    }
    let transcript = ''
    try {
      transcript = await deps.transcribe(await clip.bytes())
    } catch (err) {
      if (err instanceof SttUnavailableError) {
        logger.warn('[reaction] speech-to-text unavailable; will retry', { reactionId })
        return 'unavailable'
      }
      if (!(err instanceof SttError)) throw err
      if (attempt < MAX_ATTEMPTS) {
        logger.warn('[reaction] transcription failed; will retry', { reactionId, attempt, err: err.message })
        return 'failed'
      }
      logger.warn('[reaction] transcription failed on final attempt; sending without a transcript', { reactionId })
    }
    update.transcript = transcript
    update.audioUrl = clip.audioUrl
    update.status = 'ready'
  }

  // Who hears about it.
  let recipients: string[]
  let message: string
  if (fromElder) {
    const family = await db.collection('memberships')
      .where('patientUid', '==', patientUid)
      .where('status', '==', 'active')
      .get()
    recipients = family.docs.map((d) => d.data().caregiverUid as string)
    const patientName = (await db.collection('users').doc(patientUid).get()).data()?.patientName as string || '사용자'
    message = kind === 'voice' ? `${patientName}님이 음성 답장을 남기셨어요`
      : kind === 'comment' ? `${patientName}님이 답장을 남기셨어요`
      : `${patientName}님이 하트를 보내셨어요`
  } else {
    recipients = [patientUid]
    const actorName = (data.actorName as string) || '가족'
    message = kind === 'comment' ? `${actorName}님이 글을 남겼어요` : `${actorName}님이 하트를 보냈어요`
  }

  const finished = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data()
    if (!fresh || fresh.notified !== false) return false
    tx.update(ref, update)
    for (const recipientUid of recipients) {
      tx.set(db.collection('notifications').doc(), {
        recipientUid,
        patientUid,
        actorUid,
        type: `reaction.${kind}`,
        message,
        memoId: data.memoId ?? null,
        reactionId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    return true
  })
  if (finished) logger.info('[reaction] handled', { reactionId, kind, fromElder, notified: recipients.length })
  // The parent's own words (spoken or written) are worth a push; hearts and
  // family comments stay in the app.
  if (finished && fromElder && (kind === 'voice' || kind === 'comment')) {
    await (deps.push ?? pushToUsers)(recipients, {
      title: '오늘하루',
      body: message,
      data: { type: `reaction.${kind}`, patientUid, memoId: String(data.memoId ?? ''), reactionId },
    })
  }
  return 'done'
}

/** Serial queue over unannounced reactions, with the memo pipeline's retry rules. */
export class ReactionScheduler {
  private queue: string[] = []
  private queued = new Set<string>()
  private running: string | null = null
  private attempts = new Map<string, number>()
  private timers = new Map<string, NodeJS.Timeout>()
  private stopped = false

  constructor(private deps: ReactionDeps = defaultReactionDeps) {}

  enqueue(id: string) {
    if (this.stopped || this.queued.has(id) || this.running === id || this.timers.has(id)) return
    this.queued.add(id)
    this.queue.push(id)
    void this.pump()
  }

  forget(id: string) {
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.delete(id)
    this.attempts.delete(id)
    if (this.queued.delete(id)) this.queue = this.queue.filter((q) => q !== id)
  }

  stop() {
    this.stopped = true
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 50))
  }

  private retryLater(id: string, delayMs: number) {
    if (this.stopped) return
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id)
      this.enqueue(id)
    }, delayMs))
  }

  private async pump() {
    if (this.running || this.stopped) return
    const id = this.queue.shift()
    if (!id) return
    this.queued.delete(id)
    this.running = id
    const attempt = (this.attempts.get(id) ?? 0) + 1
    try {
      const outcome = await processReaction(id, attempt, this.deps)
      if (outcome === 'done') {
        this.attempts.delete(id)
      } else if (outcome === 'unavailable') {
        this.retryLater(id, UNAVAILABLE_RETRY_MS)
      } else {
        this.attempts.set(id, attempt)
        this.retryLater(id, RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)])
      }
    } catch (err) {
      logger.error('[reaction] processing threw', { reactionId: id, attempt, err: String(err) })
      if (attempt >= MAX_ATTEMPTS) {
        await getFirestore().collection('reactions').doc(id).update({ status: 'error', notified: true }).catch(() => {})
        this.attempts.delete(id)
      } else {
        this.attempts.set(id, attempt)
        this.retryLater(id, RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)])
      }
    } finally {
      this.running = null
      void this.pump()
    }
  }
}

/** Subscribe to reactions nobody has been told about yet. The initial
 *  snapshot includes everything written while the worker was down. */
export function watchReactions(scheduler: ReactionScheduler): () => void {
  return getFirestore()
    .collection('reactions')
    .where('notified', '==', false)
    .onSnapshot(
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type === 'removed') scheduler.forget(change.doc.id)
          else scheduler.enqueue(change.doc.id)
        }
      },
      (err) => {
        logger.error('[reaction] listener died; exiting so launchd restarts us', { err: String(err) })
        process.exit(1)
      },
    )
}
