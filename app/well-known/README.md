# /.well-known for the simple edition's site (dayliesimple.web.app)

Served only by the simple build: `vite.config.ts` copies these into
`dist/.well-known/` when `mode === 'simple'`, so trackbyphoto.web.app never
claims links for the shared app id `com.zymer.daylie`.

- `apple-app-site-association` — Universal Links for `/pair` (team
  8LH5JSLM82). `firebase.json` serves it as `application/json`. The app side is
  `ios/App/App/App.entitlements` (`applinks:dayliesimple.web.app`).
- `assetlinks.json` — Android App Links for `/pair`. Fingerprints:
  1. upload key (`fastlane/upload-keystore.jks`, alias `upload`)
  2. shared debug key (`android/app/debug.keystore`)
  3. **to add:** the Play App Signing key, from Play Console → Test and
     release → App integrity, once the app exists there. Store installs are
     signed with that key, so App Links don't verify for them until it is
     listed here and the site is redeployed.
