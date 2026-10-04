import type { Timestamp } from 'firebase/firestore'

/** Categories the worker's model picks from (worker/src/llm/prompt.ts), plus
 *  가족/꽃 from the older six-category schema, still present on old memos. */
export type MemoCategory =
  | '식사' | '카페' | '산책' | '여행' | '출장' | '이동' | '쇼핑' | '휴식' | '모임' | '운동' | '자연' | '병원' | '기타'
  | '가족' | '꽃'

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
  | 'local-llm'         // Mac mini worker's local vision model (Ollama)
  | 'local-stub'        // fallback after the local model failed repeatedly
  | 'cloud-vision'      // legacy: Gemini/OpenAI Cloud Function (older memos)
  | 'cloud-stub'        // legacy: Cloud Function fallback (older memos)
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
  /** Short label for lists: "Tiger Sugar · 반포4동, 서초구". */
  place: string
  /** Full street address from the phone's GPS fix, shown on the detail page. */
  address?: string
  /** One-word activity category, surfaced as a chip in the UI and as the
   *  byCategory key on the admin dashboard. */
  activity: MemoCategory
  /** The subject line: short but concrete ("공항 편의점에 들렀어요"). Written
   *  by the worker's vision model from the photo, or by family (humanEdited). */
  memo: string
  /** Two or three short sentences describing the photo, shown in the box on
   *  the detail page. Empty on older memos and on the stub. */
  scene?: string
  status: 'pending' | 'ready' | 'error'
  createdAt: Timestamp
  /** Present when the photo was captured on a native iOS device. */
  tags?: MemoVisionTags
  /** Which tier produced the memo — useful for the AI source badge. */
  memoSource?: MemoSource
  /** Specific model used (e.g. 'gemma4:e4b'; older memos: 'gemini-2.5-flash').
   *  Only present on local-llm / cloud-vision memos; absent on device / stub. */
  model?: string
  /** True once a guardian has hand-edited the memo. Blocks the worker
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
  /** Home, set by family in 설정 → 집 위치. The worker compares each photo's
   *  location with it to tell a trip from everyday life; when unset it infers
   *  home from where most photos are taken. */
  home?: { lat: number; lng: number; label: string } | null
  /** 'managed' when a family member registered this elder (부모님 등록하기):
   *  the elder's phone is linked by a pairing code instead of a Google
   *  sign-in, and family owns the settings. Absent for self-managed users. */
  accountType?: 'managed'
}

/** users/{patientUid}/devices/{deviceId} — a phone linked to a family-managed
 *  elder. Written only by the worker (pair / unlink). */
export interface ElderDevice {
  id: string
  name: string
  platform: string
  pairedAt: Timestamp | null
  status: 'active' | 'revoked'
}

/** pairings/{id} — one-time phone-linking code (only its hash is stored). */
export interface Pairing {
  id: string
  patientUid: string
  purpose: 'onboard' | 'repair'
  mode: 'remote' | 'qr'
  status: 'pending' | 'awaiting-approval' | 'approved' | 'denied' | 'used' | 'expired'
  claimedBy: string | null
  deviceInfo: { name: string; platform: string } | null
  expiresAt: Timestamp
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
  /** Caregiver's real (Google) name, stamped by the Mac mini worker from the
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
export type ConsentType = 'sensitive_data' | 'third_party_share' | 'notice_ack'
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
 *  the Mac mini worker when a caregiver does something material; the elder reads
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
