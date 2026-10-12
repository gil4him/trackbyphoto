#!/usr/bin/env bash
# Design-review screenshots of the simple edition on the emulators
# (docs/DAYLIE_V3_UI_FIX.md): cd e2e && bash ui-shots.sh [A0]  → docs/v3-ui/<phase>-*.png
# Nothing touches a real project (project "demo-…").
set -euo pipefail
cd "$(dirname "$0")/.."
export UI_PHASE="${1:-${UI_PHASE:-A0}}"
[ -d /opt/homebrew/opt/openjdk@21/bin ] && export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
[ -d e2e/node_modules ] || (cd e2e && npm install --no-audit --no-fund >/dev/null)

echo "[ui-shots] building the simple site for the emulators…"
(cd app && VITE_USE_EMULATOR=1 \
  VITE_FIREBASE_PROJECT_ID=demo-trackbyphoto \
  VITE_FIREBASE_API_KEY=demo-key \
  VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_FIREBASE_STORAGE_BUCKET=demo-trackbyphoto.appspot.com \
  VITE_FIREBASE_MESSAGING_SENDER_ID=0 \
  VITE_FIREBASE_APP_ID=demo \
  npx vite build --mode simple --outDir ../e2e/.tmp/ui-site --emptyOutDir >/dev/null)

firebase emulators:exec --only auth,firestore,storage --project demo-trackbyphoto "node e2e/ui-shots.mjs"
