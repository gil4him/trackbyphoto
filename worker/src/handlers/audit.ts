/**
 * Settings-change audit + elder notification (formerly the
 * onUserSettingsChanged Firestore trigger).
 *
 * The patient's settings (recipients, cadence, retention…) live in
 * `users/{patientUid}` and are written directly from the client — the elder
 * editing their own doc, or an admin/guardian caregiver editing it for them.
 * Firestore rules already gate WHO may write; this records WHAT changed and
 * notifies the elder when the change came from a caregiver (§8 abuse
 * safeguard: "audit log of every settings/recipient change" + "elder is
 * notified when a caregiver changes anything material").
 *
 * Trusted actor: rules force `users.lastModifiedBy == request.auth.uid` on every
 * client write, so we can attribute the change without an auth context. When
 * the actor is the elder themselves we stay silent — no self-notifications.
 *
 * A Cloud Function trigger was handed before/after snapshots. A snapshot
 * listener only sees "after", so the worker keeps the last-seen copy of every
 * users doc in a local JSON cache (see SettingsCache) that survives restarts.
 * Changes made while the worker was down are diffed against that cache on the
 * startup snapshot, so they're still audited (attributed to the last writer).
 * Known gap: if the cache file is lost, the first sighting of each doc becomes
 * the new baseline and any offline change to it goes unaudited.
 *
 * This only ever writes to `auditLogs` and `notifications`, never back to
 * `users`, so it can't recurse.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from '../log.js'

interface Recipient {
  name: string
  phone: string
}

type Settings = Record<string, unknown>

// Settings keys we treat as material for a generic 'settings.update' log.
// `recipients` is handled separately (add/remove granularity); the meta fields
// are bookkeeping and must never count as a change on their own.
const META_KEYS = new Set(['lastModifiedBy', 'lastModifiedAt'])
const RECIPIENTS_KEY = 'recipients'
// Written only by the worker (rules stop clients from touching them), and
// audited by the request that changes them. A plan change or a day counter
// must never reach the elder as "가족이 설정을 바꿨어요".
const WORKER_KEYS = new Set(['plan', 'dayCounters', 'channels', 'digest'])

function recipientKey(r: Recipient): string {
  return `${r.name} ${r.phone}`
}

// Diff two recipient lists into added/removed entries (order-insensitive,
// keyed on name+phone so a reorder isn't reported as a change).
function diffRecipients(before: Recipient[], after: Recipient[]) {
  const beforeKeys = new Set(before.map(recipientKey))
  const afterKeys = new Set(after.map(recipientKey))
  const added = after.filter((r) => !beforeKeys.has(recipientKey(r)))
  const removed = before.filter((r) => !afterKeys.has(recipientKey(r)))
  return { added, removed }
}

// Non-recipient, non-meta keys whose value changed.
function changedSettingKeys(before: Settings, after: Settings): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const k of keys) {
    if (META_KEYS.has(k) || WORKER_KEYS.has(k) || k === RECIPIENTS_KEY) continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k)
  }
  return changed
}

/** Plain-JSON copy of a Firestore doc, so Timestamps etc. compare the same
 *  whether they came from a live snapshot or from the cache file. */
export function toPlain(data: Settings): Settings {
  return JSON.parse(JSON.stringify(data)) as Settings
}

/**
 * Record a users/{patientUid} edit. `before`/`after` follow the old trigger's
 * contract: initial seed (no before) and deletion (no after) are ignored.
 */
export async function processSettingsChange(
  patientUid: string,
  before: Settings | undefined,
  after: Settings | undefined,
): Promise<void> {
  if (!before || !after) return
  before = toPlain(before)
  after = toPlain(after)

  const actorUid = typeof after.lastModifiedBy === 'string' ? after.lastModifiedBy : ''

  // Elder editing their own settings, or an unattributed write — nothing to
  // flag. The safeguard is specifically about caregiver-initiated changes.
  if (!actorUid || actorUid === patientUid) return

  const { added, removed } = diffRecipients(
    Array.isArray(before[RECIPIENTS_KEY]) ? (before[RECIPIENTS_KEY] as Recipient[]) : [],
    Array.isArray(after[RECIPIENTS_KEY]) ? (after[RECIPIENTS_KEY] as Recipient[]) : [],
  )
  const otherChanged = changedSettingKeys(before, after)

  if (added.length === 0 && removed.length === 0 && otherChanged.length === 0) return

  const db = getFirestore()
  const batch = db.batch()
  const log = (action: string, details: Record<string, unknown>) =>
    batch.set(db.collection('auditLogs').doc(), {
      patientUid,
      actorUid,
      action,
      details,
      timestamp: FieldValue.serverTimestamp(),
    })
  const notify = (type: string, message: string) =>
    batch.set(db.collection('notifications').doc(), {
      recipientUid: patientUid, // safeguard notices are read by the elder
      patientUid,
      actorUid,
      type,
      message,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    })

  if (added.length > 0) {
    log('recipient.add', { recipients: added })
    notify('recipient.add', `가족이 받는 사람을 추가했어요: ${added.map((r) => r.name).join(', ')}`)
  }
  if (removed.length > 0) {
    log('recipient.remove', { recipients: removed })
    notify('recipient.remove', `가족이 받는 사람을 삭제했어요: ${removed.map((r) => r.name).join(', ')}`)
  }
  if (otherChanged.length > 0) {
    log('settings.update', { fields: otherChanged })
    notify('settings.update', '가족이 설정을 변경했어요.')
  }

  await batch.commit()
  logger.info('[audit] settings change recorded', { patientUid, actorUid, added: added.length, removed: removed.length, otherChanged })
}

/** Last-seen copy of every users doc, persisted to disk (atomic rename). */
export class SettingsCache {
  private data: Record<string, Settings> = {}
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private file: string) {
    try {
      this.data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Settings>
    } catch {
      logger.warn('[audit] no settings cache yet; first sighting of each users doc becomes the baseline', { file })
    }
  }

  get(uid: string): Settings | undefined {
    return this.data[uid]
  }

  set(uid: string, value: Settings | undefined) {
    if (value) this.data[uid] = toPlain(value)
    else delete this.data[uid]
    this.scheduleSave()
  }

  private scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 500)
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }
}

/** Subscribe to users/* and audit every change against the cache. */
export function watchUserSettings(cache: SettingsCache): () => void {
  // Serialize processing so two quick edits to one doc diff in order.
  let chain: Promise<void> = Promise.resolve()
  return getFirestore()
    .collection('users')
    .onSnapshot(
      (snap) => {
        for (const change of snap.docChanges()) {
          const uid = change.doc.id
          const before = cache.get(uid)
          const after = change.type === 'removed' ? undefined : change.doc.data()
          cache.set(uid, after)
          chain = chain
            .then(() => processSettingsChange(uid, before, after))
            .catch((err) => logger.error('[audit] failed to record settings change', { uid, err: String(err) }))
        }
      },
      (err) => {
        logger.error('[audit] users listener died; exiting so launchd restarts us', { err: String(err) })
        process.exit(1)
      },
    )
}
