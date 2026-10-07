# App ID change: `com.gil4him.trackbyphoto` → `com.zymer.daylie`

The code side is done on branch `app-id-zymer-daylie`. Everything below has to be done by
hand in web consoles. Work top to bottom — later steps depend on earlier ones.

Nothing was on Google Play yet, so Android is a clean start. iOS had TestFlight builds under
the old ID, so iOS becomes a **new** App Store Connect app (an existing app's bundle ID
can't be changed).

> **Don't merge the PR until steps 1–5 are done.** A push to `main` makes CI upload to
> TestFlight right away (`ci.yml` job `ios`), and that fails until the new App ID, profile and
> App Store Connect app exist. Also, the PR's **Android build check will fail** until the new
> `google-services.json` is in: the old file only lists `com.gil4him.trackbyphoto`, so the
> google-services Gradle plugin stops with "No matching client found for package name".

---

## 0. Before you start

- [x] New upload keystore (the old password was lost; nothing had been uploaded to Play,
      so a new key is fine). The old file is kept as `app/fastlane/upload-keystore.OLD.jks`.
      The new `app/fastlane/upload-keystore.jks` (alias `upload`, RSA 2048, 10000 days) has one
      random password for store and key, stored only in `app/fastlane/.env`. Keep a copy in
      your password manager: if it is lost, Play needs an upload-key reset.
- [ ] Update the GitHub secrets for CI — they still hold the **old** keystore:
      `ANDROID_KEYSTORE_BASE64` (`base64 -i app/fastlane/upload-keystore.jks`),
      `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` (the password from `.env`).
- [x] In your local `app/fastlane/.env` (not in git), change
      `IOS_BUNDLE_ID=com.zymer.daylie` and `ANDROID_PACKAGE=com.zymer.daylie`.

## 1. Firebase — new Android app (project `trackbyphoto-app`)

- [x] Firebase console → Project settings → General → **Add app → Android**
  - Package name: `com.zymer.daylie`
  - Nickname: 오늘하루 Android
- [ ] Add these SHA fingerprints (Project settings → your new Android app → Add fingerprint).
      The debug ones are already in; the upload ones are new:
  - debug.keystore SHA-1: `96:C5:BD:07:06:A3:F7:ED:82:17:FC:E9:4F:76:92:C4:85:EC:62:3B`
  - debug.keystore SHA-256: `9C:56:B3:4E:11:E6:0B:CC:C7:DE:E3:89:38:01:56:20:0B:0B:1D:BC:27:D6:9B:07:4C:6B:06:E4:C4:64:5B:1B`
  - upload-keystore SHA-1: `8B:8E:A0:C0:7C:91:29:18:1E:28:E7:F6:E3:F8:47:57:E5:79:C2:23`
  - upload-keystore SHA-256: `7A:23:E4:25:1D:25:6D:44:BF:B5:43:0B:D4:6E:A1:81:A4:6C:1D:51:15:EA:26:25:60:39:73:68:C4:69:F6:9E`
  - Later, after the first Play upload: the **Play App Signing** key's SHA-1 / SHA-256
    (Play Console → Test and release → App integrity → App signing). Google re-signs the app
    with that key, so without it sign-in fails for people who install from Play.
- [ ] Download the new **google-services.json** → give it to Claude (it replaces
      `app/android/app/google-services.json`).

## 2. Firebase — new iOS app

- [x] Firebase console → Add app → **iOS** — Bundle ID: `com.zymer.daylie`, Team ID `8LH5JSLM82`.
- [ ] Download the new **GoogleService-Info.plist** → give it to Claude (it replaces
      `app/ios/App/App/GoogleService-Info.plist`).
  - Note: `app/ios/App/App/Info.plist` hard-codes the Google sign-in URL scheme
    (`com.googleusercontent.apps.…`). If the new plist has a different
    `REVERSED_CLIENT_ID`, Claude must update that line too, or Google sign-in on iPhone
    won't come back to the app.
- [ ] Cloud Messaging (push): Project settings → Cloud Messaging → the **new** iOS app →
      upload the APNs auth key (.p8) again. It's per app, so it doesn't carry over.
- [ ] Once both new apps work, you can delete the old `com.gil4him.trackbyphoto` apps from
      Firebase (optional, do it last).

## 3. Apple Developer — new App ID

- [x] developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+** → App IDs → App
  - Bundle ID (explicit): `com.zymer.daylie`
  - Capabilities: ☑ **Push Notifications**, ☑ **Sign in with Apple**
- Heads-up: the iOS project currently has **no `.entitlements` file**, and the app only
  signs in with Google (`providers: ['google.com']`). Turning the capabilities on in the
  portal is enough for the profile; the app itself still needs an entitlements file
  (`aps-environment`, and Sign in with Apple if you add it) before iPhone push or Apple
  login will actually work. Ask Claude for that as a separate change.

## 4. Signing — regenerate with match

Run on the Mac, from `app/`, after step 3 (needs the new App ID to exist):
- [x] `bundle exec fastlane match appstore --app_identifier com.zymer.daylie`
  - Not readonly: this makes a new App Store provisioning profile for the new ID and saves it
    to the certificates repo. The existing distribution certificate is reused.
  - If capabilities change later, run it again with `--force` so the profile picks them up.
- The Xcode project now says `match AppStore com.zymer.daylie`; fastlane fills in the exact
  name match created at build time, so you don't need to edit Xcode.

## 5. App Store Connect — new app

The app name **오늘하루** is held by the old app record, and App Store names are unique.
- [ ] First rename the **old** app (`com.gil4him.trackbyphoto`): App Store Connect → the old
      app → App Information → Name → e.g. `오늘하루 (old)`. Save. (TestFlight-only apps can
      be renamed freely; it may take a few minutes for the name to free up.)
- [ ] My Apps → **+ → New App**
  - Platform iOS, Name **오늘하루**, Primary language Korean,
    Bundle ID `com.zymer.daylie`, SKU e.g. `daylie-ios`
- [ ] Add your TestFlight testers again (tester groups don't carry over).
- [ ] Re-enter any App Privacy / age rating / review notes you'd already filled in.

## 6. Google Cloud — OAuth clients (project `trackbyphoto-app`)

Firebase usually creates these for you when you add the apps in steps 1–2; check them in
console.cloud.google.com → APIs & Services → Credentials.
- [ ] **Android** OAuth client: package `com.zymer.daylie` + each SHA-1 from step 1 (debug,
      upload, Play App Signing). One client per SHA-1.
- [ ] **iOS** OAuth client: bundle ID `com.zymer.daylie`.
- [ ] The **Web** client (used for Firebase Auth) stays the same — no change.
- [ ] OAuth consent screen: no change needed (it's per project, not per app).
- [ ] Optional cleanup later: delete the old `com.gil4him.trackbyphoto` Android/iOS clients.

## 7. Google Play Console

- [x] Create the app (오늘하루) — the package name is set by the first upload, so the first
      AAB must already be `com.zymer.daylie` (it is, on this branch). Done on the
      Digioptics, LLC account; internal testing list "오늘하루 가족 테스터".
- [x] Play upload key made: service account
      `play-upload@trackbyphoto-app.iam.gserviceaccount.com` (no Cloud roles), key saved as
      `app/fastlane/play-key.json` (gitignored) and as GitHub secret `PLAY_JSON_KEY_BASE64`.
      Android Publisher API enabled.
- [ ] Play Console (Digioptics account) → Users and permissions → **Invite new users** →
      `play-upload@trackbyphoto-app.iam.gserviceaccount.com` → App permissions: 오늘하루 →
      Releases (release to testing tracks + production) → Invite.
- [ ] GitHub keystore secrets — see step 0 (CI skips the Play upload without them).
- [ ] The very first AAB may have to be uploaded by hand in Play Console (Google requires one
      manual upload before the API can publish to a new app).
- [ ] Opt in to **Play App Signing**, then add its SHA fingerprints to Firebase (step 1).

## 8. Back to Claude

- [x] Hand over the new `google-services.json` and `GoogleService-Info.plist`.
- [x] Claude swaps them in, checks the Info.plist URL scheme, rebuilds, and adds them to the PR.
- [ ] Test on a real phone: Google sign-in, push notification, photo upload, 꾹 누르고 말하기.
- [ ] Merge the PR, then run `beta_ios` / `beta_android`.

---

### Kept on purpose

The microphone permissions (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`,
`NSMicrophoneUsageDescription`) stay. The voice-reply feature uses them:
`app/src/lib/recorder.ts` (getUserMedia + MediaRecorder), the 🎙️ 꾹 누르고 말하기 button in
`app/src/pages/FamilyNews.tsx`, and the 목소리로 답장 받기 setting in `app/src/pages/Settings.tsx`.
