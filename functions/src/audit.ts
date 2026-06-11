/**
 * Settings-change audit + elder notification.
 *
 * The patient's settings (recipients, cadence, retention…) live in
 * `users/{patientUid}` and are written directly from the client — the elder
 * editing their own doc, or an admin/guardian caregiver editing it for them.
 * Firestore rules already gate WHO may write; this trigger records WHAT changed
 * and notifies the elder when the change came from a caregiver (§8 abuse
 * safeguard: "audit log of every settings/recipient change" + "elder is
 * notified when a caregiver changes anything material").
 *
 * Trusted actor: rules force `users.lastModifiedBy == request.auth.uid` on every
 * client write, so the trigger can attribute the change without an auth context
 * (Firestore triggers don't carry one). When the actor is the elder themselves
 * we stay silent — no self-notifications, no noise.
 *
 * This trigger only ever writes to `auditLogs` and `notifications`, never back
 * to `users`, so it can't recurse.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onDocumentWritten, type Change, type DocumentSnapshot } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'

const REGION = 'us-west1'

interface Recipient {
  name: string
  phone: string
}

// Settings keys we treat as material for a generic 'settings.update' log.
// `recipients` is handled separately (add/remove granularity); the meta fields
// are bookkeeping and must never count as a change on their own.
const META_KEYS = new Set(['lastModifiedBy', 'lastModifiedAt'])
const RECIPIENTS_KEY = 'recipients'

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
function changedSettingKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const k of keys) {
    if (META_KEYS.has(k) || k === RECIPIENTS_KEY) continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k)
  }
  return changed
}

export const onUserSettingsChanged = onDocumentWritten(
  { document: 'users/{patientUid}', region: REGION, memory: '256MiB' },
  async (event) => {
    const change = event.data as Change<DocumentSnapshot> | undefined
    const before = change?.before.data()
    const after = change?.after.data()

    // Only care about edits to an existing doc. Initial seed (no before) and
    // deletion (no after) carry no caregiver action to audit.
    if (!before || !after) return

    const patientUid = event.params.patientUid as string
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
      notify('recipient.add', `보호자가 받는 사람을 추가했어요: ${added.map((r) => r.name).join(', ')}`)
    }
    if (removed.length > 0) {
      log('recipient.remove', { recipients: removed })
      notify('recipient.remove', `보호자가 받는 사람을 삭제했어요: ${removed.map((r) => r.name).join(', ')}`)
    }
    if (otherChanged.length > 0) {
      log('settings.update', { fields: otherChanged })
      notify('settings.update', '보호자가 설정을 변경했어요.')
    }

    await batch.commit()
    logger.info('[audit] settings change recorded', { patientUid, actorUid, added: added.length, removed: removed.length, otherChanged })
  },
)
