# Shipping the app with Fastlane

Fastlane is a tool that does the tedious "build → sign → upload to the store"
steps for you with one command. This folder configures it for **오늘하루 /
TrackByPhoto** (bundle ID `com.zymer.daylie`).

> You'll need a Mac with Xcode (for iOS) and Android Studio (for Android), plus a
> paid **Apple Developer** account and a **Google Play Console** account. Some
> steps below are one-time account setup — once done, releasing is one command.

## The commands (run these from the `app/` folder)

| Command | What it does |
|---|---|
| `bundle exec fastlane build_android_aab` | Builds the signed **AAB** and stops — prints its path. Nothing is uploaded. |
| `bundle exec fastlane beta_ios` | Builds & signs iOS, uploads to **TestFlight** (testers). |
| `bundle exec fastlane beta_android` | Builds a signed **AAB**, uploads to Play **internal** track. |
| `bundle exec fastlane release_ios` | Uploads a build + the Korean listing to the **App Store** (submitting is opt-in). |
| `bundle exec fastlane release_android` | Uploads to the Play **production** track. |
| `bundle exec fastlane beta` / `release` | Does both platforms at once. |

## Which edition am I shipping? (`EDITION`)

Two apps are built from this one codebase: **simple** (오늘하루, Firebase project
`daylie-simple-4df13`) and **full** (TrackByPhoto, `trackbyphoto-app`). Every lane
defaults to **simple**. Override it either way:

```sh
EDITION=full bundle exec fastlane release_ios
bundle exec fastlane release_ios edition:full
```

Under the hood each lane runs `npm run build:<edition>` and then
`npm run native:<edition>`, which copies that edition's
`GoogleService-Info.plist` / `google-services.json` into `ios/` and `android/`
and runs `npx cap sync`.

> **Those two native config files are tracked, and the committed state is
> `full`.** A simple-edition build therefore leaves your working tree dirty on
> purpose. Run `npm run native:full` before you commit. No lane here ever runs
> `git add` or `git commit` — the tree is yours to clean up.

## Shipping the simple edition (오늘하루) the first time

Google will not accept the very first production release over the API, so it's a
manual upload once and automated after that:

1. `bundle exec fastlane build_android_aab` → copy the absolute `.aab` path it
   prints at the end.
2. Play Console → **Test and release → Production → Create new release** → drag
   that `.aab` in. Fill **App content → App access** with the demo login (see
   `REVIEW_NOTES.md`), then roll out.
3. Play Console → **Test and release → App integrity** → copy the **App signing
   key** SHA-256 and add it to `app/well-known/assetlinks.json`, then redeploy
   hosting — otherwise App Links don't verify for store installs.
4. From then on: `bundle exec fastlane release_android` (uploads the AAB plus
   `fastlane/metadata/android/ko-KR` — listing text, icon, feature graphic).

iOS, once the app record exists in App Store Connect:

```sh
bundle exec fastlane release_ios                            # upload build + listing, don't submit
bundle exec fastlane release_ios submit_for_review:true     # also submit to App Review
bundle exec fastlane release_ios submit_for_review:true automatic_release:true
```

`release_ios` options (all default to the cautious choice):

| Option | Default | Meaning |
|---|---|---|
| `edition:` | `simple` | which app to build |
| `submit_for_review:` | `false` | upload only; you press **Submit** yourself |
| `automatic_release:` | `false` | you press **Release** after review passes |
| `skip_metadata:` | upload if `fastlane/metadata` has files | the Korean listing |
| `skip_screenshots:` | skip while `fastlane/screenshots` is empty | set `skip_screenshots:false` once you've put screenshots there |

`release_android` takes `edition:`, `skip_metadata:`, `skip_images:` and
`skip_screenshots:` with the same "upload it if the folder has files" defaults.

## The store listing lives in this folder

- `metadata/ko/` — App Store listing in Korean (name, subtitle, description,
  keywords, promotional text, release notes, URLs). `metadata/copyright.txt` and
  `metadata/primary_category.txt` (Lifestyle) are shared across locales. The age
  rating questionnaire is answered in App Store Connect, not here.
- `metadata/review_information/notes.txt` — the App Review notes. The demo
  **login** is never committed: put it in App Store Connect's *Sign-in required*
  fields (or in local, gitignored `demo_user.txt` / `demo_password.txt`).
- `metadata/android/ko-KR/` — Play listing (title, short/full description,
  `changelogs/default.txt`) plus `images/icon.png` (512×512) and
  `images/featureGraphic.png` (1024×500). Drop phone screenshots in
  `images/phoneScreenshots/` and they upload automatically.
- `screenshots/` — App Store screenshots. Doesn't exist yet: make
  `fastlane/screenshots/ko/`, drop the PNGs in, and `release_ios` starts
  uploading them (while it's missing or empty they're skipped, so an empty run
  can never wipe the screenshots already on the listing).
- `REVIEW_NOTES.md` — what to paste into App Review and Play *App access*,
  in Korean and English.

## One-time setup

1. **Install the tools**: from `app/`, run `bundle install` (installs Fastlane).
2. **Android project** (only needed once): run `npx cap add android` from `app/`
   — this generates the `android/` folder the Android lanes build.
3. **Secrets**: copy `fastlane/.env.example` to `fastlane/.env` and fill in every
   value. The guide for each value is in the comments of that file. Put the key
   files (`AuthKey_*.p8`, `play-key.json`, `upload-keystore.jks`) inside this
   `fastlane/` folder. **None of these are committed to git** — keep backups
   somewhere safe (a password manager).
4. **iOS signing**: open `ios/App` in Xcode once, select the team under
   Signing & Capabilities, and in *Product → Scheme → Manage Schemes* make sure
   the **App** scheme is checked as **Shared**. (For team/CI signing later, ask
   an engineer about Fastlane `match`.)
5. **Android keystore** (only once): create your upload key with
   `keytool -genkey -v -keystore fastlane/upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`
   then put the passwords/alias into `.env`. `ANDROID_KEYSTORE_PATH` may be
   absolute or `~`-prefixed — the simple edition's upload key lives at
   `~/daylie-secrets/simple/upload-keystore.jks` (mode 600), outside the repo.
   Lose that file and you can never update the app, so back it up.
   Its SHA-256 must also appear in `app/well-known/assetlinks.json`; check with
   `/opt/homebrew/opt/openjdk@21/bin/keytool -list -v -keystore <path> -alias upload`.

## Running it automatically with GitHub Actions

There's also a workflow at `.github/workflows/mobile-release.yml` that runs these
lanes on GitHub's servers (a Mac runner for iOS, Linux for Android) — no local
build needed. Trigger it by hand: **GitHub → Actions → "Mobile release" → Run
workflow → pick a lane**.

For it to work you add your secrets once under **Settings → Secrets and variables
→ Actions**. The full list is in the comment at the top of the workflow file.
Two notes:

- File-type secrets (the Apple `.p8`, the Play JSON, the Android `.jks`) are
  stored **base64-encoded**. On a Mac: `base64 -i thefile` and paste the output.
- iOS CI signing uses **match**: run `fastlane match init` then
  `fastlane match appstore` once locally to create a small private "certs" repo,
  then add `MATCH_GIT_URL`, `MATCH_PASSWORD`, and `MATCH_GIT_BASIC_AUTHORIZATION`
  as secrets. (Local builds don't need match — Xcode signs them.)

## What each file here is

- **Appfile** — the IDs (bundle ID, Apple login, team) Fastlane needs.
- **Fastfile** — the actual build/upload recipes (the lanes above).
- **Matchfile** — where the iOS signing certificate/profile are stored (for CI).
- **.env.example** — a template listing every secret/ID you must provide.
- **.env** (you create it) — your real secrets; never committed.
