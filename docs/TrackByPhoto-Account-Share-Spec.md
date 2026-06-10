# TrackByPhoto — Account Share (Caregiver Access) Spec

**Version:** Draft v1 · June 8, 2026
**Owner:** Shawn Lee (CEO)
**Status:** For engineering review + Korean privacy-counsel review before build

---

## 1. One-liner

Let an adult child (보호자) securely view and control an elder's (어르신) TrackByPhoto account — settings, recipients, memos — with the elder's consent, without ever sharing a login.

---

## 2. Problem & why

The elder operates the app (takes the photo → auto-memo → KakaoTalk). But the elder usually can't, and shouldn't have to, manage settings, recipients, or troubleshooting. Today there's no safe way for family to help. The result: the caregiver either shares the elder's password (insecure, unauditable, breaks on password change) or can't help at all.

This is the standard architecture for elder/dementia tech (see GrandPad's "Family Administrator," MyChart "proxy access"). For an Alzheimer's product it is effectively a requirement.

---

## 3. Users & roles

| Role (KR / EN) | Who | What they do |
|---|---|---|
| **어르신 (Owner)** | The patient | Operates the app. Owns the account and the data. Can revoke any caregiver. |
| **보호자 · 관리 (Admin)** | Adult child / primary caregiver | Full settings control: recipients, app config, receives memos. |
| **보호자 · 보기 (Viewer)** | Other relative | Read-only: sees memos and status, changes nothing. |
| **법정대리인 (Guardian)** | Court-appointed guardian (성년후견) | Same as Admin, but authority is backed by legal guardianship for elders who have lost capacity. |

---

## 4. Goals / Non-goals

**Goals**
- Caregiver gets their own login and a clearly-scoped role.
- Elder-simple: the elder's screen never changes; all complexity lives in the caregiver view.
- Consent is captured correctly and stored as evidence (doubles as PIPA compliance record).
- Every sensitive change is logged and the elder is notified.

**Non-goals (v1)**
- No payments / financial actions through shared access.
- No more than ~5 caregivers per elder (keeps custom-claims small).
- No web admin console yet — caregiver uses the same mobile app in "caregiver mode."

---

## 5. Core flows (plain language)

1. **Invite** — On the elder's device (or by an existing Admin), tap "가족 초대." App generates a 6-digit code (or a KakaoTalk invite link). The code expires in 24h.
2. **Accept** — The child installs TrackByPhoto, signs up with their own phone/account, enters the code. They're now linked to that elder with the assigned role.
3. **Consent gate** — Before the link becomes active, the consent screen runs (see §7). Membership stays `invited` until valid consent exists.
4. **Manage** — Admin sees the elder's settings, recipient list, and memo history; can edit settings and recipients.
5. **Revoke** — The elder (or an Admin) can remove any caregiver in one tap. Access is cut immediately.

---

## 6. Permissions matrix

| Action | Owner | Admin | Viewer | Guardian |
|---|:--:|:--:|:--:|:--:|
| View memos & status | ✅ | ✅ | ✅ | ✅ |
| Edit app settings | ✅ | ✅ | — | ✅ |
| Add/remove KakaoTalk recipients | ✅ | ✅ | — | ✅ |
| Invite other caregivers | ✅ | ✅ | — | ✅ |
| Revoke a caregiver | ✅ | ✅* | — | ✅ |
| Delete account | ✅ | — | — | ✅ |
| Change roles | ✅ | — | — | ✅ |

\* An Admin can revoke other caregivers but the Owner/Guardian always outranks. Every action in the bottom four rows is logged + triggers an elder notification.

---

## 7. Consent & PIPA compliance (the critical part)

The auto-memos reveal health, location, and daily-routine patterns → likely **민감정보 (sensitive personal information)** under Korea's PIPA. This drives three hard requirements:

1. **Two separate consents, not one checkbox:**
   - (a) Explicit opt-in to process **sensitive data**.
   - (b) Separate **third-party provision** consent to share with the caregiver — stating *what* is shared, *with whom*, *why*, and the *right to refuse*.
2. **Capacity-aware consent** (because of Alzheimer's):
   - **Self-consent** captured early, while the elder still has capacity (default path).
   - **Guardian consent** for elders who have lost capacity — via adult guardianship (성년후견); store the guardian reference.
3. **Consent stored as evidence** — every consent record keeps timestamp, who granted it, scope, and the version of the consent text shown. This is both your compliance proof and your audit trail.

> ⚠️ Not legal advice. The sensitive-data + vulnerable-user combination should be reviewed by a Korean privacy attorney before launch.

---

## 8. Elder-abuse safeguards (engineer against misuse)

Shared access can be weaponized by a bad family actor. Required mitigations:
- Audit log of every settings/recipient/account change (who, what, when).
- Elder is notified when a caregiver changes anything material.
- New caregivers default to **Viewer**; Admin must be deliberately granted.
- High-stakes actions (delete account, change recipients) require a second confirmation.

---

## 9. Success metrics (v1)

- % of elder accounts with ≥1 active caregiver (target: adoption signal).
- Time-to-first-successful-setup for a caregiver-assisted elder (lower = better).
- Support tickets about "can't change settings" / shared-password issues (should drop to ~0).
- 100% of shares have a stored, valid consent record (compliance gate — must be 100%).

---

## 10. Phased rollout

- **MVP:** Owner + Admin roles, invite-by-code, consent screen, revoke, audit log, multi-recipient KakaoTalk.
- **v2:** Viewer role, KakaoTalk invite link, Guardian path, caregiver web console.

---

# Appendix A — Firebase data model

Principle: **never share logins.** Every human (elder or caregiver) is a separate Firebase Auth account with their own UID. Access is granted through `memberships`, modeled many-to-many (one elder ↔ many caregivers; one caregiver ↔ many elders).

```
users/{uid}
  name: string
  phone: string            // for KakaoTalk delivery
  language: 'ko'
  createdAt: timestamp

memberships/{patientUid}_{caregiverUid}     // deterministic ID = cheap lookups
  patientUid: string
  caregiverUid: string
  role: 'admin' | 'viewer' | 'guardian'
  status: 'invited' | 'active' | 'revoked'
  invitedBy: uid
  consentId: string        // must exist before status can be 'active'
  createdAt / acceptedAt / revokedAt: timestamp

invites/{code}
  patientUid: string
  role: 'admin' | 'viewer'
  createdBy: uid
  expiresAt: timestamp
  used: bool

consents/{consentId}
  patientUid: string
  type: 'sensitive_data' | 'third_party_share'
  grantedBy: 'self' | 'guardian'
  guardianUid: string|null
  scope: string            // what data is covered
  consentTextVersion: string
  timestamp: timestamp

memos/{memoId}
  patientUid: string
  photoUrl / text: string
  recipients: [uid]        // elder + caregivers
  createdAt: timestamp

auditLogs/{logId}
  patientUid: string
  actorUid: string
  action: string           // e.g. 'recipient.add', 'settings.update', 'caregiver.revoke'
  details: map
  timestamp: timestamp
```

---

# Appendix B — Roles / RBAC approach

Use the recommended **hybrid**:
- **Custom claims** on the caregiver's auth token for the fast path, e.g. `{ patients: { "<patientUid>": "admin" } }`. Free to read inside security rules.
  - Caveats to know: ~1000-byte limit (fine at ≤5 elders), and claims refresh only on token refresh (~1h) — so for *instant* revocation also check the Firestore membership `status`.
- **Firestore membership docs** as the source of truth for flexible checks and immediate revocation.

---

# Appendix C — Firestore security-rule sketch (illustrative)

```js
function isOwner(patientUid) {
  return request.auth.uid == patientUid;
}

function membership(patientUid) {
  return get(/databases/$(database)/documents/memberships/
             $(patientUid + '_' + request.auth.uid)).data;
}

function isActive(patientUid) {
  return membership(patientUid).status == 'active';
}

function hasRole(patientUid, role) {
  return isActive(patientUid) && membership(patientUid).role == role;
}

match /memos/{memoId} {
  // Owner or any active caregiver can read
  allow read: if isOwner(resource.data.patientUid)
              || isActive(resource.data.patientUid);
}

match /users/{patientUid}/settings/{doc=**} {
  // Owner, admin, or guardian can edit settings
  allow read:  if isOwner(patientUid) || isActive(patientUid);
  allow write: if isOwner(patientUid)
               || hasRole(patientUid, 'admin')
               || hasRole(patientUid, 'guardian');
}

match /memberships/{id} {
  // A caregiver link can only go 'active' once a consent record exists
  allow update: if isOwner(resource.data.patientUid)
               && exists(/databases/$(database)/documents/
                         consents/$(request.resource.data.consentId));
}
```

> Engineers: add Firebase rules **unit tests** (rules-unit-testing) and run them in CI before every deploy.

---

# Appendix D — KakaoTalk delivery notes

- Alimtalk supports a **recipient list** → one auto-memo can fan out to the elder + each caregiver.
- Every template needs **manual Kakao approval**; needs a business channel + **SenderKey**.
- Alimtalk must be **informational, not promotional**. Keep memo templates info-only.
