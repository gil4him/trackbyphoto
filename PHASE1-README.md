# TrackByPhoto · Phase 1

Phase 1 implements the core flow from the plan:

**Patient taps the big button → camera opens → photo uploads to Firebase Cloud Storage → Cloud Function generates a memo (time + activity + place) → memo appears live in the "오늘" timeline.**

Kakao delivery is intentionally deferred to Phase 2 — the AI memo quality is verified first.

## Live URLs

| | URL |
|---|---|
| **Prototype** (clickable mockup, GitHub Pages) | https://gil4him.github.io/trackbyphoto/ |
| **Phase 1 app** (real PWA on Firebase Hosting) | https://trackbyphoto-app.web.app |
| Firebase console | https://console.firebase.google.com/project/trackbyphoto-app |

## Repo layout

```
/                                  ← repo root (also Firebase project root)
├── firebase.json                  Hosting, Firestore, Storage, Functions, Emulators
├── .firebaserc                    default project = trackbyphoto-app
├── firestore.rules                per-user memo + settings rules
├── firestore.indexes.json         (uid ASC, takenAt DESC)
├── storage.rules                  per-uid photo access, 8MB image cap
├── index.html, trackbyphoto-prototype.html, TrackByPhoto-Plan.md  ← prototype files
├── app/                           Vite + React + TypeScript PWA
│   ├── src/
│   │   ├── firebase.ts            SDK init + emulator wiring
│   │   ├── App.tsx                tab router + settings subscription
│   │   ├── hooks/                 useAuth (anonymous), useMemos (live)
│   │   ├── lib/capture.ts         getGeo() + uploadPhoto() with metadata
│   │   ├── pages/                 Home, Today, Settings
│   │   └── components/            Tabs, Toast, Processing
│   ├── .env.local                 ← Firebase web SDK config (gitignored)
│   └── vite.config.ts             react + vite-plugin-pwa
└── functions/                     Cloud Functions (Node 20, TypeScript)
    └── src/index.ts               onPhotoUploaded (Storage trigger)
```

## What works right now

- ✅ Firebase project `trackbyphoto-app` created (Seoul region targeted)
- ✅ Web app registered, SDK config written to `app/.env.local`
- ✅ React PWA scaffolded, builds clean, **deployed to Firebase Hosting**
- ✅ Cloud Function code written (Storage trigger → stub AI → memo doc), builds clean
- ✅ Firestore + Storage rules written
- ✅ `index.html` redirect on GitHub Pages still serves the prototype at `gil4him.github.io/trackbyphoto`

## What needs you (3 one-time console clicks)

The live app at `https://trackbyphoto-app.web.app` will load, but logging in / taking a photo won't work yet until these are enabled. Each is a single button click in the Firebase console.

### 1. Enable Anonymous Auth
→ https://console.firebase.google.com/project/trackbyphoto-app/authentication/providers
Click **"Anonymous"** → **Enable** → Save.

### 2. Enable Firestore (Cloud Firestore API + create database)
→ https://console.firebase.google.com/project/trackbyphoto-app/firestore
Click **"Create database"** → **Native mode** → location **asia-northeast3 (Seoul)** → Done.

### 3. Upgrade to Blaze (required for Cloud Functions deployment)
→ https://console.firebase.google.com/project/trackbyphoto-app/usage/details
Click **"Modify plan"** → **Blaze (pay-as-you-go)** → add a billing card.

> **About cost:** Blaze sounds scary but for one-patient testing it's effectively **$0/month**. The free tier covers 50k Firestore reads/day, 1GB Storage, 2M Function invocations/month, 5GB egress. You only start paying past those.

Set a budget alert at $5 for peace of mind:
→ https://console.cloud.google.com/billing/budgets?project=trackbyphoto-app

### Once those three are done, run:
```bash
cd /Volumes/Seagate_Por/1_trackbyphoto
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```
That deploys rules + the Cloud Function. After this, the live app is fully functional end-to-end.

## Local development

### Run the React app pointing at the real cloud backend:
```bash
cd app
npm run dev
```
Then open the URL shown (typically `http://localhost:5173`). For iPhone testing on the same Wi-Fi, use the network URL Vite prints. *Camera + GPS need HTTPS or localhost — `localhost` is fine; LAN IP is not.*

### Run everything locally (emulators, no cloud needed):
```bash
firebase emulators:start            # in repo root, in one terminal
cd app && VITE_USE_EMULATOR=1 npm run dev   # in another terminal
```
Emulators run Firestore, Storage, Auth, Functions, plus a UI at http://localhost:4000.

> Requires **Java** for the Firestore emulator. Install with `brew install --cask temurin` if missing.

## What's stubbed (and how to unstub)

The Cloud Function in `functions/src/index.ts` has two stub functions:

- **`generateActivity()`** — returns a random warm Korean phrase. Replace with a Gemini Vision call:
  ```ts
  import { GoogleGenerativeAI } from '@google/generative-ai'
  const ai = new GoogleGenerativeAI(process.env.GEMINI_KEY!)
  const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const [bytes] = await file.download()
  const result = await model.generateContent([
    { inlineData: { data: bytes.toString('base64'), mimeType: contentType ?? 'image/jpeg' } },
    '이 어르신이 무엇을 하고 있는지 한 문장으로 따뜻하게 묘사해주세요. JSON으로 {activity, category}를 반환.'
  ])
  ```
  Get a key at https://aistudio.google.com/apikey, then set with:
  ```bash
  firebase functions:secrets:set GEMINI_KEY
  ```
  And reference it in the function options: `secrets: ['GEMINI_KEY']`.

- **`reverseGeocode()`** — returns a random place name. Replace with Kakao Local API:
  ```ts
  const r = await fetch(
    `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`,
    { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}` } }
  )
  ```

## Phase 1 → Phase 2

Once you've validated the auto-memo quality (Phase 1), Phase 2 adds:
- Kakao Login for the guardian
- Recipients management (persisted, with phone validation)
- Cloud Scheduler trigger → daily digest builder
- Alimtalk template + send via NHN Cloud / Solapi / Aligo
- Secure per-day public photo page (token-protected route, served by Hosting)
