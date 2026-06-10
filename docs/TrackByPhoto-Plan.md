# TrackByPhoto — Product, Technical & Cost Plan

**One line:** An ultra-simple iPhone web app where an Alzheimer's patient taps one button to take a photo, and the app automatically turns it into a memo (time, activity, place) and sends a friendly summary to family and friends on KakaoTalk.

*Prepared June 6, 2026 · Planning package v1 (Product + Technical + Cost)*

---

## Part 1 — Product Plan & Features

### Who it's for

| Role | What they do | What they need |
|---|---|---|
| **The patient** (primary user) | Taps one button to capture a moment | One screen, one big button, huge text, no decisions |
| **Family / friends** (recipients) | Receive daily/real-time updates on KakaoTalk | Reassurance with zero effort — read a message, done |
| **You / a guardian** (admin) | Sets up recipients, timing, automation | A simple settings screen, run once |

### The core principle

Everything is designed so the patient never has to think. The default experience is: **open app → press the big button → a photo is taken → the memo writes itself → it's saved and shared automatically.** No typing, no menus, no confirmation required. The "automatic" behavior is the default; settings let a family member *optionally* turn on a confirmation step or change what's shared.

### Primary flow (patient)

1. Patient opens the app (already "installed" on the home screen — looks like a normal app).
2. One full-screen friendly button: **사진 찍기 (Take a photo)**.
3. Camera opens, patient takes the picture.
4. The app automatically fills in:
   - **Date & time** — from the phone clock.
   - **Location** — phone GPS, converted to a readable place name (e.g., "자택", "행복요양센터", "한강공원").
   - **Activity** — an AI vision model looks at the photo and writes a short, warm description ("점심 식사 중", "산책 중", "가족과 함께").
5. A simple card appears for ~3 seconds: *"오후 12:30 · 점심 식사 · 자택 — 저장되었어요"* then returns home. Done.

### Family flow (recipients)

Based on the schedule you set, family members get a KakaoTalk message such as:

> **[엄마의 하루]** 오늘 5건의 일상이 기록되었어요.
> 오전 9:10 산책 · 오후 12:30 점심 식사 · 오후 3:00 가족과 함께 …
> 사진 보기 → (보안 링크)

Tapping the link opens a clean web page with the day's photos and memos. (Sending a *link* instead of the photos themselves keeps cost low and avoids KakaoTalk's image-message restrictions — see Part 2.)

### Feature list

**MVP (build first):**

- One-tap photo capture (full-screen button, elder-friendly).
- Automatic memo generation: time + GPS place name + AI activity description.
- Local timeline ("오늘 / Today") the patient or a visiting family member can scroll.
- Automatic delivery to KakaoTalk on a schedule.
- A secure daily web page that holds each day's photos + memos.
- **Settings** (run by a family member / guardian):
  - **Recipients** — who gets the updates (name + phone or Kakao).
  - **Timing** — real-time, daily summary (e.g., every evening 8 PM), or weekly. *(Your chosen "configurable" behavior.)*
  - **Automation level** — fully automatic (default) **or** show a quick confirm/edit step. *(Your chosen "configurable" behavior.)*
  - Language, text size.

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
[ iPhone Safari PWA ]                 [ Firebase backend ]              [ Delivery ]
  Big "Take photo" button   ─photo─▶   Cloud Storage (photo)
  GPS at moment of capture  ─coords▶   Cloud Function:
                                          1. Vision AI  → activity text
                                          2. Reverse geocode → place name
                                          3. Save memo (Firestore)
                                          4. On schedule → build digest ──▶ KakaoTalk
  "오늘" timeline           ◀─reads──   Firestore                          (Alimtalk)
  Settings                  ─writes─▶   Firestore                     Family taps link
                                        Hosting: secure day page  ◀──────────┘
```

### Frontend — iPhone web app (PWA)

A **Progressive Web App** built in React (works great with your Cursor / Firebase setup). Why a PWA and not a native App Store app: it's far cheaper (no $99/yr Apple fee, no review delays), updates instantly, and the patient just taps **"홈 화면에 추가" (Add to Home Screen)** once — after that it looks and launches like a real app, full screen.

- **Camera:** the simplest reliable method on iPhone Safari is a capture input (`<input type="file" accept="image/*" capture="environment">`) which opens the camera directly. One tap, no library needed.
- **Location:** the browser **Geolocation API** captures GPS coordinates at the moment of the photo (needs HTTPS + a one-time permission). Note: photos taken through the web camera often have their embedded GPS stripped by iOS, so we read location live at capture time rather than from the photo file.
- **Design:** bright, Apple-style, very large touch targets and type. See the included clickable mockup (`trackbyphoto-prototype.html`).

### Backend — Firebase (your existing stack)

- **Auth** — Kakao Login (or simple phone login) for the guardian/admin. The patient's device stays signed in permanently so they never log in.
- **Cloud Storage** — stores the photos.
- **Firestore** — stores memos and settings (small, cheap text data).
- **Cloud Functions** — the "brain": when a new photo lands, it calls the vision AI, reverse-geocodes the location, writes the memo, and (on schedule) assembles and sends the KakaoTalk digest.
- **Cloud Scheduler** — triggers the daily/weekly digest send.
- **Hosting** — serves the PWA and the secure per-day photo page (free SSL included).

### The AI part (your "detection & creation" interest)

When a photo arrives, a Cloud Function sends it to a **small, low-cost vision model** (e.g., Gemini Flash, GPT-4o-mini class, or Claude Haiku) with a prompt like *"이 어르신이 무엇을 하고 있는지 한 문장으로 따뜻하게 묘사해줘."* The model returns a short activity description. We combine that with the time and the reverse-geocoded place into the final memo. Optionally we also map it to a simple category (식사 / 산책 / 휴식 / 가족) for nicer summaries. This is cheap and fast — see Part 3.

**Location naming:** raw GPS coordinates are turned into a Korean place name using the **Kakao Local (reverse geocoding) API** — it's accurate for Korean addresses/landmarks and effectively free at this scale, and keeps you in the Kakao ecosystem.

### KakaoTalk delivery — the important constraint

KakaoTalk does **not** let an app freely message anyone. There are two legitimate paths; I recommend starting with the first.

**Option A — Alimtalk (알림톡) — *recommended for "designated family/friends".***
Alimtalk is Kakao's business-notification channel. It can reach **any phone number**, even people who haven't added your channel as a friend — which is exactly what "send to designated family" needs. Requirements: a business KakaoTalk channel, and each message uses a **pre-approved template** (Kakao reviews templates and only allows *informational* content, so we word it as a factual notice: *"[OO님 일상 알림] 오늘 N건의 활동이 기록되었습니다. 확인하기 →"*). You send through a Kakao Biz-Message reseller (NHN Cloud, Solapi, Aligo, etc.). Cost ≈ **₩8 per message** (~$0.006). Because you have a business, this is very achievable. Note: Kakao updated Alimtalk sending-eligibility rules effective Jan 1, 2026, and template approval takes a few business days — plan a short lead time.

**Option B — Kakao "send to friends" Message API — free, but constrained.**
Free to send, but: every recipient must install the app, log in with Kakao, and be a Kakao *friend* of the patient's account; you can message at most **5 friends** at a time; and Kakao must review/approve the feature for your app. Good for a tiny family group that's comfortable installing an app; more friction for elderly relatives.

**Recommendation:** send an **Alimtalk text message containing a secure link** to that day's photo page. This reaches anyone by phone number, costs the least (text rate, not image rate), passes template review as a notification, and shows the photos on a clean web page. Keep Option B in mind as a free fallback for a close family group.

### Data model (simplified)

```
users/{guardianId}                → profile, patientName
settings/{patientId}              → recipients[], cadence, automationMode, language
photos/{photoId}                  → storageUrl, takenAt, lat, lng
memos/{memoId}                    → photoId, takenAt, placeName, activityText, category, sentStatus
dailyPages/{patientId}/{date}     → token (secure link), memoIds[]
```

### Privacy & security (handle carefully — this is sensitive data)

This app handles **health-adjacent information, photos, and live location of a vulnerable person**, so privacy is not optional:

- **Consent:** because the patient has diminished capacity, get documented consent from the patient's legal guardian, and a clear notice. Korea's **PIPA (개인정보보호법)** treats health and location data as sensitive — collect the minimum, state the purpose, and allow deletion.
- **Access control:** the secure day-page links should be unguessable tokens that expire; only designated recipients can view. Photos in Storage locked down by Firebase Security Rules.
- **Encryption:** HTTPS everywhere (default on Firebase) and encryption at rest.
- **Retention:** decide a default (e.g., auto-delete photos after 90 days) to limit risk and cost.

---

## Part 3 — Cost Estimate

All figures approximate, June 2026. ~₩1,350 ≈ $1 (exchange rate fluctuates).

### Per-unit costs

| Item | Cost | Notes |
|---|---|---|
| AI vision (per photo) | **~₩0.3–2.7** ($0.0002–0.002) | Small vision model; negligible per photo |
| Reverse geocoding (per photo) | **~₩0 (free tier)** | Kakao Local API, generous free quota |
| KakaoTalk Alimtalk (per message) | **~₩8** ($0.006), market range ₩4.8–15 | Text notification with link |
| KakaoTalk FriendTalk w/ image | ₩15–20 | Only if you embed photos in the message (not recommended) |
| KakaoTalk "send to friends" API | **Free** | But constrained (see Part 2, Option B) |
| Firebase | Mostly **free tier** at one-patient scale | Cost grows with stored photos |

### Example: 1 patient, ~20 photos/day, 3 family recipients

| Scenario | Kakao messages/mo | Est. monthly total |
|---|---|---|
| **Daily summary** (1 digest/day × 3 people) | ~90 | **~₩3,000–7,000 (~$2–6)** |
| **Real-time** (every photo × 3 people) | ~1,800 | **~₩18,000–25,000 (~$14–19)** |

The big takeaway: **cadence is the cost driver.** AI and storage are pennies; KakaoTalk messages are where money goes. Your "configurable timing" setting is therefore also a cost control — daily summary is ~3× cheaper than real-time. A good default is **daily summary**, with real-time available for those who want it.

### One-time / setup

| Item | Cost | Notes |
|---|---|---|
| KakaoTalk business channel + Alimtalk template approval | Free–low (via reseller) | Needs business registration number; ~few days review. Resellers may ask a small prepaid deposit |
| Domain name | ~₩15,000/yr | Optional; Firebase gives a free subdomain + SSL |
| Apple App Store | **₩0** | It's a web app (PWA) — no store fee, no review |
| Development | Your main cost | Built on tools you already use (Cursor, Firebase) |

### Scaling note

At ~10 patients on daily summaries you're still looking at roughly **$20–60/month** in running costs total — this stays cheap until you're at real volume, at which point Firebase storage and Kakao messages scale linearly and predictably.

---

## Recommended build path

1. **Phase 0 — Prototype (this week):** approve the UI direction in the included mockup; lock the capture → auto-memo flow.
2. **Phase 1 — Core app:** PWA capture + GPS + Firebase storage + AI memo + the "오늘" timeline. No Kakao yet — verify the auto-memo quality first.
3. **Phase 2 — Delivery:** add the secure day-page + Kakao Alimtalk digest + Settings (recipients, cadence, automation).
4. **Phase 3 — Polish & pilot:** test with one real family, tune AI wording in Korean, set retention/consent, then expand.

## Decisions I need from you to finalize the build

- **Kakao path for launch:** start with **Alimtalk** (reaches anyone by phone, ~₩8/msg) or the **free friends API** (everyone installs the app)?
- **Photo retention:** keep forever, or auto-delete after e.g. 90 days?
- **Default cadence:** confirm **daily evening summary** as the default?
- **Consent owner:** who is the patient's guardian for the consent/notice?

---

## Sources

- [Kakao Alimtalk — Sending Alim Talk (Kakao i Connect)](https://docs.kakaoi.ai/kakao_i_connect_message/bizmessage_eng/agent/at/)
- [KakaoTalk Bizmessage / Alimtalk Overview (NHN Cloud)](https://docs.nhncloud.com/en/Notification/KakaoTalk%20Bizmessage/en/alimtalk-overview/)
- [Kakao Talk Message API (Developers)](https://developers.kakao.com/docs/latest/en/kakaotalk-message/common)
- [알림톡/친구톡/문자 발송 단가 (Kakao 고객센터)](https://cs.kakao.com/helps_html/1073208485?locale=ko)
- [알림톡 가격 비교 2026 (AtoZ Soft)](https://blog.atozsoft.co.kr/magazine/alimtalk-price-comparison-2026)
- [카카오 알림톡 발송 가능 기준 변경 안내 (26.1.1 시행)](https://docs.channel.io/updates/ko/articles/%EA%B3%B5%EC%A7%80-%EC%B9%B4%EC%B9%B4%EC%98%A4-%EC%95%8C%EB%A6%BC%ED%86%A1-%EB%B0%9C%EC%86%A1-%EA%B0%80%EB%8A%A5-%EA%B8%B0%EC%A4%80-%EB%B3%80%EA%B2%BD-%EC%95%88%EB%82%B42611-%EC%8B%9C%ED%96%89-f9f70118)
- [AI API Pricing Comparison 2026 (IntuitionLabs)](https://intuitionlabs.ai/articles/ai-api-pricing-comparison-grok-gemini-openai-claude)
- [Gemini API pricing (Google)](https://ai.google.dev/gemini-api/docs/pricing)
