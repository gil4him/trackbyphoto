# Shipping the app with Fastlane

Fastlane is a tool that does the tedious "build → sign → upload to the store"
steps for you with one command. This folder configures it for **오늘하루 /
TrackByPhoto** (bundle ID `com.gil4him.trackbyphoto`).

> You'll need a Mac with Xcode (for iOS) and Android Studio (for Android), plus a
> paid **Apple Developer** account and a **Google Play Console** account. Some
> steps below are one-time account setup — once done, releasing is one command.

## The commands (run these from the `app/` folder)

| Command | What it does |
|---|---|
| `bundle exec fastlane beta_ios` | Builds & signs iOS, uploads to **TestFlight** (testers). |
| `bundle exec fastlane beta_android` | Builds a signed **AAB**, uploads to Play **internal** track. |
| `bundle exec fastlane release_ios` | Uploads a build to the **App Store** (you press final "Submit" in the web console). |
| `bundle exec fastlane release_android` | Uploads to the Play **production** track. |
| `bundle exec fastlane beta` / `release` | Does both platforms at once. |

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
   then put the passwords/alias into `.env`.

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
