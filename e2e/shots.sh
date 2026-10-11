#!/usr/bin/env bash
# Store screenshots of 오늘하루 (simple edition) on the emulators.
#   cd e2e && bash shots.sh        → e2e/.tmp/store-shots/*.png
# Nothing touches a real project (project "demo-…").
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d /opt/homebrew/opt/openjdk@21/bin ] && export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
[ -d e2e/node_modules ] || (cd e2e && npm install --no-audit --no-fund >/dev/null)

echo "[shots] building the simple site for the emulators…"
(cd app && VITE_USE_EMULATOR=1 \
  VITE_FIREBASE_PROJECT_ID=demo-trackbyphoto \
  VITE_FIREBASE_API_KEY=demo-key \
  VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_FIREBASE_STORAGE_BUCKET=demo-trackbyphoto.appspot.com \
  VITE_FIREBASE_MESSAGING_SENDER_ID=0 \
  VITE_FIREBASE_APP_ID=demo \
  npx vite build --mode simple --outDir ../e2e/.tmp/shots-site --emptyOutDir >/dev/null)

firebase emulators:exec --only auth,firestore,storage --project demo-trackbyphoto "node e2e/shots.mjs"
