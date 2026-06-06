# TrackByPhoto — Product, Technical & Cost Plan

One line: An ultra-simple iPhone web app where an Alzheimer's patient taps one button to take a photo, and the app automatically turns it into a memo (time, activity, place) and sends a friendly summary to family and friends on KakaoTalk.

Prepared June 6, 2026 · Planning package v2 — on-device AI revision

---

## Part 1 — Product Plan & Features

### Who it's for

| Role | What they do | What they need |
|---|---|---|
| The patient (primary user) | Taps one button to capture a moment | One screen, one big button, huge text, no decisions |
| Family / friends (recipients) | Receive daily/real-time updates on KakaoTalk | Reassurance with zero effort — read a message, done |
| You / a guardian (admin) | Sets up recipients, timing, automation | A simple settings screen, run once |

### The core principle

Everything is designed so the patient never has to think. The default experience is: open app → press the big button → a photo is taken → the memo writes itself → it's saved and shared automatically. No typing, no menus, no confirmation required. The "automatic" behavior is the default; settings let a family member optionally turn on a confirmation step or change what's shared.

### Primary flow (patient)

1. Patient opens the app (installed from the App Store — a normal iPhone app icon, full-screen, no Safari).
2. One full-screen friendly button: 사진 찍기 (Take a photo).
3. Camera opens, patient takes the picture.
4. The app automatically fills in:
   - **Date & time** — from the phone clock.
   - **Location** — phone GPS, converted to a readable place name (e.g., "자택", "행복요양센터", "한강공원").
   - **Activity** — Apple's on-device AI looks at the photo right on the iPhone and writes a short, warm description ("점심 식사 중", "산책 중", "가족과 함께"). The image never leaves the phone for AI interpretation.
5. A simple card appears for ~3 seconds: "오후 12:30 · 점심 식사 · 자택 — 저장되었어요" then returns home. Done.

### Family flow (recipients)

Based on the schedule you set, family members get a KakaoTalk message such as:

> [엄마의 하루] 오늘 5건의 일상이 기록되었어요.
> 오전 9:10 산책 · 오후 12:30 점심 식사 · 오후 3:00 가족과 함께 …
> 사진 보기 → (보안 링크)

Tapping the link opens a clean web page with the day's photos and memos. (Sending a link instead of the photos themselves keeps cost low and avoids KakaoTalk's image-message restrictions — see Part 2.)

### Feature list

**MVP (build first):**

- One-tap photo capture (full-screen button, elder-friendly).
- Automatic memo generation: time + GPS place name + AI activity description.
- Local timeline ("오늘 / Today") the patient or a visiting family member can scroll.
- Automatic delivery to KakaoTalk on a schedule.
- A secure daily web page that holds each day's photos + memos.
- Settings (run by a family member / guardian):
  - **Recipients** — who gets the updates (name + phone or Kakao).
  - **Timing** — real-time, daily summary (e.g., every evening 8 PM), or weekly. (Your chosen "configurable" behavior.)
  - **Automation level** — fully automatic (default) or show a quick confirm/edit step. (Your chosen "configurable" behavior.)
  - **Language, text size.**

**Later (Phase 2+):**

- Voice note attached to a photo ("녹음" — one tap).
- Daily/weekly "memory book" PDF for the patient.
- Caregiver dashboard (multiple patients) for care centers — a potential B2B revenue line.
- Gentle reminders ("아침 산책 시간이에요").
- Fall/inactivity alerts (no photo for X hours → notify family).

### What the MVP intentionally leaves out

No social feed, no comments, no accounts for the patient to manage, no in-app text entry. Every removed feature is a decision the patient doesn't have to make.

---

## Part 2 — Technical Architecture

### High-level flow

```
[ iPhone Capacitor app ]                    [ Firebase backend ]              [ Delivery ]
  Big "Take photo" button
  On-device Apple Vision → tags
  Apple Foundation Models →
     activity text (Korean)
  GPS at moment of capture
                              ─photo─────▶   Cloud Storage (photo)
                              ─memo+tags─▶   Cloud Function:
                                                1. Reverse geocode → place name
                                                2. Save memo (Firestore)
                                                3. On schedule → build digest ──▶ KakaoTalk
  "오늘" timeline             ◀─reads─────   Firestore                          (Alimtalk)
  Settings                    ─writes────▶   Firestore                     Family taps link
                                              Hosting: secure day page  ◀──────────┘
```

### Frontend — iPhone Capacitor hybrid app

The same React UI you've already seen, wrapped in a thin native iOS container using **Capacitor**. The patient still sees a single icon on the home screen — but now that icon installs from the App Store, not from a Safari "Add to Home Screen" tap. The reason for the change: only a native iOS shell can reach Apple's on-device AI (Vision + Foundation Models), which lets us do photo interpretation entirely on the iPhone — free, private, and offline.

The honest tradeoff:

- **What we gain:** the AI runs on the phone for free, the photo never leaves the device for interpretation (a meaningful PIPA privacy win), and the AI works even with no signal.
- **What it costs:** the Apple Developer Program at ~$99/yr (≈ ₩135,000/yr), plus a few business days of App Store / TestFlight review whenever we ship an update. No more instant push-to-web.

What stays the same: the React code, the bright Apple-style UI in the included mockup (`trackbyphoto-prototype.html`), and the one-tap capture flow — the patient experience is identical.

- **Camera:** Capacitor's native Camera plugin opens the iPhone camera directly. One tap, like the web version, but with full native iOS image quality and metadata.
- **Location:** Capacitor's native Geolocation plugin reads GPS at the moment of capture (one-time iOS permission).
- **Design:** unchanged — bright, Apple-style, very large touch targets and type.

### Backend — Firebase (your existing stack)

- **Auth** — Kakao Login (or simple phone login) for the guardian/admin. The patient's device stays signed in permanently so they never log in.
- **Cloud Storage** — stores the photos.
- **Firestore** — stores memos and settings (small, cheap text data).
- **Cloud Functions** — when the iPhone uploads a photo together with the already-generated memo text (and optional tag JSON), the function reverse-geocodes the location, saves the memo to Firestore, and (on schedule) assembles and sends the KakaoTalk digest. **No vision AI here anymore** — the heavy lifting moved to the iPhone.
- **Cloud Scheduler** — triggers the daily/weekly digest send.
- **Hosting** — serves the secure per-day photo page (free SSL included).

### The AI part (your "detection & creation" interest) — now fully on-device

Photo interpretation runs on the iPhone itself, inside a small custom **Capacitor Swift plugin** that exposes Apple's two AI layers to the React app:

**Layer 1 — Apple Vision framework (all iPhones, iOS 11+).** Reads the photo the instant it's captured and extracts structured tags:

- **Image classification** — what's in the picture (food, person, indoor, outdoor, animal, etc.).
- **Korean text recognition (OCR)** — any signs, menus, or labels visible in the image.
- **Face detection** — just the *count* of faces present. Not identity, not who. (Identity recognition would be a separate, opt-in feature and is out of scope.)

The output is a small JSON of tags like `{ scene: "식사", objects: ["식탁", "음식"], faceCount: 2, ocr: "한정식" }`.

**Layer 2 — Apple Foundation Models (Apple Intelligence's on-device LLM).** Takes those tags and writes the one-sentence Korean memo, with a prompt like *"이 어르신이 무엇을 하고 있는지 한 문장으로 따뜻하게 묘사해줘."* Example output: *"식탁에서 가족과 함께 한정식을 드시는 중이에요."* Runs on iPhone 15 Pro and newer, iOS 26+.

**Tiered fallback for older iPhones (this matters — many elderly users won't have the newest device):**

1. *Preferred:* Vision tags → Foundation Models → warm Korean memo. iPhone 15 Pro and newer.
2. *If Foundation Models is unavailable:* Vision tags → a Korean **sentence template** filled from the tags (e.g. "자택에서 식사 중이에요"). Works on any iPhone with iOS 11+. No AI cost, no network needed.
3. *Optional last-resort if Vision alone is too thin:* a tiny **text-only** cloud call that sends just the tags as text — never the image — to a small text model. A fraction of a vision call's cost, and the photo still never leaves the phone.

**The privacy win:** the photo never leaves the device for AI interpretation. Only the finished memo text (and optionally the tag JSON) is sent to the backend for assembly and delivery. The photo itself is then uploaded separately to your private Firebase Storage for the family to view via the secure day-page link — that part is by design, not AI input. This is a meaningful PIPA-friendly posture for sensitive health-adjacent imagery.

**Location naming:** raw GPS coordinates are turned into a Korean place name using the Kakao Local (reverse geocoding) API on the backend — accurate for Korean addresses/landmarks, effectively free at this scale, and keeps you in the Kakao ecosystem.

### KakaoTalk delivery — the important constraint

KakaoTalk does not let an app freely message anyone. There are two legitimate paths; I recommend starting with the first.

**Option A — Alimtalk (알림톡) — recommended for "designated family/friends".**
Alimtalk is Kakao's business-notification channel. It can reach any phone number, even people who haven't added your channel as a friend — which is exactly what "send to designated family" needs. Requirements: a business KakaoTalk channel, and each message uses a pre-approved template (Kakao reviews templates and only allows informational content, so we word it as a factual notice: "[OO님 일상 알림] 오늘 N건의 활동이 기록되었습니다. 확인하기 →"). You send through a Kakao Biz-Message reseller (NHN Cloud, Solapi, Aligo, etc.). Cost ≈ ₩8 per message (~$0.006). Because you have a business, this is very achievable. Note: Kakao updated Alimtalk sending-eligibility rules effective Jan 1, 2026, and template approval takes a few business days — plan a short lead time.

**Option B — Kakao "send to friends" Message API — free, but constrained.**
Free to send, but: every recipient must install the app, log in with Kakao, and be a Kakao friend of the patient's account; you can message at most 5 friends at a time; and Kakao must review/approve the feature for your app. Good for a tiny family group that's comfortable installing an app; more friction for elderly relatives.

**Recommendation:** send an Alimtalk text message containing a secure link to that day's photo page. This reaches anyone by phone number, costs the least (text rate, not image rate), passes template review as a notification, and shows the photos on a clean web page. Keep Option B in mind as a free fallback for a close family group.

### Data model (simplified)

```
users/{guardianId}                → profile, patientName
settings/{patientId}              → recipients[], cadence, automationMode, language
photos/{photoId}                  → storageUrl, takenAt, lat, lng
memos/{memoId}                    → photoId, takenAt, placeName, activityText, category, sentStatus
dailyPages/{patientId}/{date}     → token (secure link), memoIds[]
```

### Privacy & security (handle carefully — this is sensitive data)

This app handles health-adjacent information, photos, and live location of a vulnerable person, so privacy is not optional:

- **Consent:** because the patient has diminished capacity, get documented consent from the patient's legal guardian, and a clear notice. Korea's PIPA (개인정보보호법) treats health and location data as sensitive — collect the minimum, state the purpose, and allow deletion.
- **Access control:** the secure day-page links should be unguessable tokens that expire; only designated recipients can view. Photos in Storage locked down by Firebase Security Rules.
- **Encryption:** HTTPS everywhere (default on Firebase) and encryption at rest.
- **Retention:** decide a default (e.g., auto-delete photos after 90 days) to limit risk and cost.

---

## Part 3 — Cost Estimate

All figures approximate, June 2026. ~₩1,350 ≈ $1 (exchange rate fluctuates).

### Per-unit costs

| Item | Cost | Notes |
|---|---|---|
| AI vision (per photo) | ₩0 | Runs on-device (Apple Vision + Foundation Models). The optional text-only cloud fallback is a fraction of a vision call's cost. |
| Reverse geocoding (per photo) | ~₩0 (free tier) | Kakao Local API, generous free quota |
| KakaoTalk Alimtalk (per message) | ~₩8 ($0.006), market range ₩4.8–15 | Text notification with link |
| KakaoTalk FriendTalk w/ image | ₩15–20 | Only if you embed photos in the message (not recommended) |
| KakaoTalk "send to friends" API | Free | But constrained (see Part 2, Option B) |
| Firebase | Mostly free tier at one-patient scale | Cost grows with stored photos |

### Example: 1 patient, ~20 photos/day, 3 family recipients

| Scenario | Kakao messages/mo | Est. monthly total |
|---|---|---|
| Daily summary (1 digest/day × 3 people) | ~90 | ~₩3,000–7,000 (~$2–6) |
| Real-time (every photo × 3 people) | ~1,800 | ~₩18,000–25,000 (~$14–19) |

**The big takeaway:** AI is now free (it runs on the iPhone), and storage is pennies. The only real running cost is KakaoTalk message cadence — which makes your "configurable timing" setting a direct cost lever. Daily summary is ~3× cheaper than real-time. A good default is daily summary, with real-time available for those who want it.

### One-time / setup

| Item | Cost | Notes |
|---|---|---|
| KakaoTalk business channel + Alimtalk template approval | Free–low (via reseller) | Needs business registration number; ~few days review. Resellers may ask a small prepaid deposit |
| Domain name | ~₩15,000/yr | Optional; Firebase gives a free subdomain + SSL |
| Apple Developer Program | ~$99/yr (~₩135,000/yr) | Required to ship the Capacitor hybrid app on iPhone. Add a few business days of App Store / TestFlight review per submission — no instant push-to-web anymore. |
| Development | Your main cost | Built on tools you already use (Cursor, Firebase) |

### Scaling note

At ~10 patients on daily summaries you're still looking at roughly $20–60/month in running costs total — this stays cheap until you're at real volume, at which point Firebase storage and Kakao messages scale linearly and predictably.

---

## Recommended build path

1. **Phase 0 — Prototype (this week):** approve the UI direction in the included mockup; lock the capture → auto-memo flow.
2. **Phase 1 — Core React app:** capture + GPS + Firebase storage + the "오늘" timeline, with a stubbed memo string. Verify the end-to-end pipeline in the web view first.
3. **Phase 2 — Wrap with Capacitor + on-device AI plugin:** turn the React app into a native iOS shell with Capacitor; build the **Swift plugin** that bridges Apple Vision (Layer 1) and Apple Foundation Models (Layer 2) to JavaScript; implement the **tiered fallback** for older iPhones. Test on **both a recent iPhone (15 Pro or newer, has Foundation Models) and an older iPhone (Vision-tags-plus-template fallback only)** via TestFlight before any pilot — this is the make-or-break compatibility check for elderly users on hand-me-down devices.
4. **Phase 3 — Delivery:** add the secure day-page + Kakao Alimtalk digest + Settings (recipients, cadence, automation).
5. **Phase 4 — Polish & pilot:** test with one real family, tune the Korean memo wording, set retention/consent, then expand.

---

## Decisions I need from you to finalize the build

1. **Kakao path for launch:** start with Alimtalk (reaches anyone by phone, ~₩8/msg) or the free friends API (everyone installs the app)?
2. **Minimum iOS version / oldest iPhone to support:** the on-device AI is tiered — Foundation Models needs iPhone 15 Pro+ on iOS 26+, while the Vision-tags-plus-template fallback works on iOS 11+. Where do we draw the line for the supported list? This affects how much we invest in the fallback, and which devices we have to keep around for TestFlight testing.
3. **Photo sharing alongside the on-device memo:** confirm the photo itself is still uploaded to Firebase Storage so family can view it via the secure day-page — separate from the memo text. The on-device AI change only moves AI *interpretation* off the cloud; we're assuming photo sharing with family is unchanged. Tell me if you'd prefer the photo also stays on-device only (memo-text-only delivery to family).
4. **Photo retention:** keep forever, or auto-delete after e.g. 90 days?
5. **Default cadence:** confirm daily evening summary as the default?
6. **Consent owner:** who is the patient's guardian for the consent/notice?

---

## Sources

- Kakao Alimtalk — Sending Alim Talk (Kakao i Connect)
- KakaoTalk Bizmessage / Alimtalk Overview (NHN Cloud)
- Kakao Talk Message API (Developers)
- 알림톡/친구톡/문자 발송 단가 (Kakao 고객센터)
- 알림톡 가격 비교 2026 (AtoZ Soft)
- 카카오 알림톡 발송 가능 기준 변경 안내 (26.1.1 시행)
- AI API Pricing Comparison 2026 (IntuitionLabs)
- Apple Vision framework — image classification, text recognition, face detection (Apple Developer docs)
- Apple Foundation Models / Apple Intelligence on-device LLM (Apple Developer docs)
- Capacitor — native iOS/Android hybrid framework (Ionic)
