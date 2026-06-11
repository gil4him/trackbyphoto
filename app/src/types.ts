import type { Timestamp } from 'firebase/firestore'

export type MemoCategory = '식사' | '산책' | '휴식' | '가족' | '꽃' | '기타'

/** On-device Apple Vision tags attached to a memo. */
export interface MemoVisionTags {
  labels: { name: string; confidence: number }[]
  text: string[]
  faceCount: number
}

/** Which tier produced the activity text. Drives the AI badge on the detail page. */
export type MemoSource =
  | 'foundation-models' // iOS 26+ Apple Intelligence on-device LLM
  | 'template'          // pre-iOS-26: Korean sentence template over Vision tags
  | 'cloud-vision'      // Gemini 2.0 Flash Vision (web upload / older iPhone)
  | 'cloud-stub'        // final fallback when Gemini is unreachable
  | 'human'             // guardian hand-edited the activity

export interface Memo {
  id: string
  /** UID of the patient (어르신) this memo belongs to. For a self-managed
   *  account this equals the uploader's uid; once caregiver-share lands a
   *  caregiver might upload on behalf of a patient and this still points at
   *  the patient, not the uploader. */
  patientUid: string
  photoPath: string        // gs path: photos/{patientUid}/{photoId}.jpg
  photoUrl: string         // public download URL
  takenAt: Timestamp
  lat: number | null
  lng: number | null
  place: string
  /** One-word activity category, surfaced as a chip in the UI and as the
   *  byCategory key on the admin dashboard. */
  activity: MemoCategory
  /** Warm one-sentence caption the family reads. Produced by Foundation
   *  Models on device, by Gemini/OpenAI in the cloud, or by the stub. ≤25자. */
  memo: string
  /** Two-sentence "그 순간" scene paragraph for the detail page. Cloud LLM
   *  + stub fill this; device tier leaves it empty (Foundation Models only
   *  writes the headline). The UI hides the section when blank. */
  scene?: string
  status: 'pending' | 'ready' | 'error'
  createdAt: Timestamp
  /** Present when the photo was captured on a native iOS device. */
  tags?: MemoVisionTags
  /** Which tier produced the memo — useful for the AI source badge. */
  memoSource?: MemoSource
  /** Specific cloud model used (e.g. 'gemini-2.5-flash', 'gpt-4o-mini').
   *  Only present on cloud-vision memos; absent on device / stub. */
  model?: string
  /** True once a guardian has hand-edited the memo. Blocks the function
   *  from ever overwriting the text on retrigger/regenerate. */
  humanEdited?: boolean
}

export interface UserSettings {
  patientName: string
  recipients: { name: string; phone: string }[]
  cadence: 'realtime' | 'daily' | 'weekly'
  autoMode: boolean
  bigText: boolean
  retention: '30' | '90' | 'forever'
}

// ────────────────────────────────────────────────────────────────────────────
// Caregiver-share (보호자) schema. See TrackByPhoto-Plan.md §7 / Appendix A.
// These describe the Firestore doc shapes only — the client UI for invite /
// accept / consent is built on top of this in a later phase.
// ────────────────────────────────────────────────────────────────────────────

export type MembershipRole = 'admin' | 'viewer' | 'guardian'
export type MembershipStatus = 'invited' | 'active' | 'revoked'

/** memberships/{patientUid}_{caregiverUid} — many-to-many link.
 *  Source of truth for who can read/write a patient's data. Used by Firestore
 *  rules; cached on the caregiver's custom claims for the fast read path. */
export interface Membership {
  patientUid: string
  caregiverUid: string
  /** Caregiver's real (Google) name, stamped by the Cloud Functions from the
   *  verified token so the patient sees a name, not a UID. May be absent on
   *  rows created before this field existed (until the caregiver re-syncs). */
  caregiverName?: string
  role: MembershipRole
  status: MembershipStatus
  invitedBy: string
  /** Required before `status` can transition to 'active'. References a doc
   *  in `consents/`. Rules enforce existence. */
  consentId: string | null
  createdAt: Timestamp
  acceptedAt: Timestamp | null
  revokedAt: Timestamp | null
}

/** invites/{code} — short-lived 6-digit code (or share link token) that lets
 *  a caregiver claim a membership without the elder reading a UID aloud. */
export interface Invite {
  patientUid: string
  role: Exclude<MembershipRole, 'guardian'>  // guardian path is out-of-band
  createdBy: string
  expiresAt: Timestamp
  used: boolean
}

/** consents/{consentId} — PIPA evidence record. Two consents must exist before
 *  a caregiver gets active access: one for processing sensitive data, one for
 *  third-party share. Each is its own doc so the legal trail is auditable. */
export type ConsentType = 'sensitive_data' | 'third_party_share'
export interface Consent {
  patientUid: string
  type: ConsentType
  grantedBy: 'self' | 'guardian'
  guardianUid: string | null
  /** Plain-language description of what data the consent covers. */
  scope: string
  /** Version tag of the consent text shown — so we can prove which wording
   *  the elder saw, even after the wording is updated. */
  consentTextVersion: string
  timestamp: Timestamp
}

/** notifications/{id} — elder-facing safeguard feed (Plan §8). Written only by
 *  Cloud Functions when a caregiver does something material; the elder reads
 *  unread notices as a dismissible banner and marks them read. */
export interface AppNotification {
  id: string
  /** Whoever the notice is addressed to — the elder for safeguard notices,
   *  a caregiver for new-photo notices. The feed subscribes on this. */
  recipientUid: string
  patientUid: string
  actorUid: string
  /** Dot-namespaced kind: 'recipient.add' | 'recipient.remove' |
   *  'settings.update' | 'caregiver.invite' | 'caregiver.accept' |
   *  'caregiver.revoke' | 'photo.new'. */
  type: string
  message: string
  /** Present on 'photo.new' — the memo the notice points at. */
  memoId?: string
  read: boolean
  createdAt: Timestamp
}

/** auditLogs/{logId} — append-only record of every sensitive change.
 *  Required mitigation for elder abuse (see Plan §8). Rules forbid update/delete. */
export interface AuditLog {
  patientUid: string
  actorUid: string
  /** Dot-namespaced action key. Examples: 'recipient.add',
   *  'settings.update', 'caregiver.revoke', 'consent.grant'. */
  action: string
  details: Record<string, unknown>
  timestamp: Timestamp
}
